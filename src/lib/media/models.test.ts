import { describe, it, expect, vi, beforeEach } from 'vitest'

// The module memoises its load promise, so each test gets a fresh copy
async function freshHydrate() {
  vi.resetModules()
  const mod = await import('./models')
  return mod.hydrateModels
}

const STUB_HTML =
  '<div class="media-model" data-src="/tours/x/fort.glb" data-caption="West gate reconstruction">' +
  '<span class="model-stub" aria-label="3D model">⬡</span>' +
  '<p class="model-label">fort.glb</p>' +
  '<figcaption>West gate reconstruction</figcaption>' +
  '</div>'

function mount(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}

describe('hydrateModels', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('does not call the loader when the container has no model stub', async () => {
    const hydrateModels = await freshHydrate()
    const loader = vi.fn(() => Promise.resolve())
    const el = mount('<figure class="media-img"><img src="/tours/x/a.png" alt="A" /></figure>')

    await hydrateModels(el, loader)

    expect(loader).not.toHaveBeenCalled()
  })

  it('upgrades a stub into a configured <model-viewer>', async () => {
    const hydrateModels = await freshHydrate()
    const loader = vi.fn(() => Promise.resolve())
    const el = mount(STUB_HTML)

    await hydrateModels(el, loader)

    const viewer = el.querySelector('model-viewer')
    expect(viewer).not.toBeNull()
    expect(viewer!.getAttribute('src')).toBe('/tours/x/fort.glb')
    expect(viewer!.getAttribute('alt')).toBe('West gate reconstruction')
    expect(viewer!.hasAttribute('camera-controls')).toBe(true)
    expect(viewer!.getAttribute('touch-action')).toBe('pan-y')
    // Placeholder pieces removed, caption preserved, stub marked hydrated
    expect(el.querySelector('.model-stub')).toBeNull()
    expect(el.querySelector('.model-label')).toBeNull()
    expect(el.querySelector('figcaption')?.textContent).toBe('West gate reconstruction')
    expect(el.querySelector<HTMLElement>('.media-model')!.dataset.hydrated).toBe('true')
  })

  it('leaves the stub intact when the loader fails', async () => {
    const hydrateModels = await freshHydrate()
    const loader = vi.fn(() => Promise.reject(new Error('offline')))
    const el = mount(STUB_HTML)

    await hydrateModels(el, loader)

    expect(el.querySelector('model-viewer')).toBeNull()
    expect(el.querySelector('.model-stub')).not.toBeNull()
    expect(el.querySelector('.model-label')?.textContent).toBe('fort.glb')
    expect(el.querySelector<HTMLElement>('.media-model')!.dataset.hydrated).toBeUndefined()
  })

  it('is idempotent — repeat calls neither duplicate viewers nor re-import', async () => {
    const hydrateModels = await freshHydrate()
    const loader = vi.fn(() => Promise.resolve())
    const el = mount(STUB_HTML)

    await hydrateModels(el, loader)
    await hydrateModels(el, loader)

    expect(el.querySelectorAll('model-viewer')).toHaveLength(1)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('retries the import on a later call after a failed load', async () => {
    const hydrateModels = await freshHydrate()
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    const el = mount(STUB_HTML)

    await hydrateModels(el, loader)
    expect(el.querySelector('model-viewer')).toBeNull()

    await hydrateModels(el, loader)
    expect(el.querySelector('model-viewer')).not.toBeNull()
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
