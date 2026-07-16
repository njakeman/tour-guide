/**
 * Runtime hydration of `.media-model` stubs into <model-viewer> elements.
 *
 * The content pipeline renders `.glb`/`.gltf` markdown references to a static
 * stub div at build time (see vite-plugin.ts renderMediaHtml). Stop bodies are
 * injected via {@html}, so a Svelte component can't sit inside them — instead
 * TourStop runs this pass over the body container after each render.
 *
 * `@google/model-viewer` (which bundles three) is dynamically imported only
 * when a stub is actually present, so it lands in its own async chunk and the
 * app shell stays small — same pattern as maplibre-gl in MapPanel.svelte. The
 * chunk is precached by the service worker, so hydration works offline.
 *
 * If the import fails (e.g. offline with a cold cache), the labelled ⬡ stub
 * simply stays visible, and the memoised promise resets so a later stop
 * navigation retries.
 */

type Loader = () => Promise<unknown>

const defaultLoader: Loader = () => import('@google/model-viewer')

let loadPromise: Promise<boolean> | null = null

function ensureLoaded(load: Loader): Promise<boolean> {
  if (!loadPromise) {
    loadPromise = load().then(
      () => true,
      () => {
        loadPromise = null
        return false
      }
    )
  }
  return loadPromise
}

export async function hydrateModels(
  container: HTMLElement,
  load: Loader = defaultLoader
): Promise<void> {
  const stubs = [...container.querySelectorAll<HTMLElement>('.media-model:not([data-hydrated])')]
  if (stubs.length === 0) return
  if (typeof customElements === 'undefined') return
  if (!(await ensureLoaded(load))) return

  for (const stub of stubs) {
    // The stop may have changed while the import was in flight
    if (!stub.isConnected || stub.dataset.hydrated) continue
    const src = stub.dataset.src
    if (!src) continue

    const viewer = document.createElement('model-viewer')
    viewer.setAttribute('src', src)
    viewer.setAttribute('alt', stub.dataset.caption || '3D model')
    viewer.setAttribute('camera-controls', '')
    // Horizontal drag orbits the model; vertical drag still scrolls the page
    viewer.setAttribute('touch-action', 'pan-y')
    viewer.setAttribute('auto-rotate', '')
    // Model bytes fetch only when the viewer scrolls near the viewport
    viewer.setAttribute('loading', 'lazy')
    // AR: Quick Look on iOS (USDZ auto-generated on-device from the GLB —
    // static models only, no ios-src needed), Scene Viewer on Android.
    // model-viewer hides the slotted button on unsupported devices (desktop).
    viewer.setAttribute('ar', '')
    viewer.setAttribute('ar-modes', 'webxr scene-viewer quick-look')
    const arButton = document.createElement('button')
    arButton.setAttribute('slot', 'ar-button')
    arButton.type = 'button'
    arButton.className = 'model-ar-button'
    arButton.textContent = '⤴ View in your space'
    viewer.appendChild(arButton)

    stub.querySelector('.model-stub')?.remove()
    stub.querySelector('.model-label')?.remove()
    stub.prepend(viewer)
    stub.dataset.hydrated = 'true'
  }
}
