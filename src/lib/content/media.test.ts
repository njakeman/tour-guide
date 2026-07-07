import { describe, it, expect } from 'vitest'
import { withBase, escapeHtml, renderMediaHtml } from './vite-plugin'

describe('withBase', () => {
  it('leaves paths unchanged at root base', () => {
    expect(withBase('/tours/x/hero.png', '/')).toBe('/tours/x/hero.png')
  })

  it('prefixes a sub-path base', () => {
    expect(withBase('/tours/x/hero.png', '/tour-guide/')).toBe('/tour-guide/tours/x/hero.png')
  })

  it('is idempotent when the base is already present', () => {
    expect(withBase('/tour-guide/tours/x.png', '/tour-guide/')).toBe('/tour-guide/tours/x.png')
  })

  it('does not treat a base-prefixed sibling path as already based', () => {
    expect(withBase('/tour-guide-media/x.png', '/tour-guide/')).toBe(
      '/tour-guide/tour-guide-media/x.png'
    )
  })

  it('leaves external URLs and data URIs unchanged', () => {
    expect(withBase('https://example.com/a.png', '/sub/')).toBe('https://example.com/a.png')
    expect(withBase('//cdn.example.com/a.png', '/sub/')).toBe('//cdn.example.com/a.png')
    expect(withBase('data:image/png;base64,AAA', '/sub/')).toBe('data:image/png;base64,AAA')
  })

  it('returns empty input unchanged', () => {
    expect(withBase('', '/sub/')).toBe('')
  })
})

describe('escapeHtml', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeHtml(`<img src="x" onerror='y'> & more`)).toBe(
      '&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt; &amp; more'
    )
  })

  it('passes plain text through', () => {
    expect(escapeHtml('West entrance · looking north')).toBe('West entrance · looking north')
  })
})

describe('renderMediaHtml', () => {
  it('renders audio for .mp3', () => {
    const html = renderMediaHtml('/tours/x/narration.mp3', 'Intro', '/')
    expect(html).toContain('<figure class="media-audio">')
    expect(html).toContain('<audio controls')
    expect(html).toContain('src="/tours/x/narration.mp3"')
    expect(html).toContain('<figcaption>Intro</figcaption>')
  })

  it('renders video for .mp4', () => {
    const html = renderMediaHtml('/tours/x/fly.mp4', 'Flythrough', '/')
    expect(html).toContain('<figure class="media-video">')
    expect(html).toContain('<video controls')
    expect(html).toContain('playsinline')
  })

  it('renders a model stub for .glb', () => {
    const html = renderMediaHtml('/tours/x/fort.glb', 'Gate', '/')
    expect(html).toContain('class="media-model"')
    expect(html).toContain('data-src="/tours/x/fort.glb"')
    expect(html).toContain('data-caption="Gate"')
    expect(html).toContain('fort.glb')
  })

  it('renders an image figure for image extensions', () => {
    const html = renderMediaHtml('/tours/x/rampart.png', 'Rampart', '/')
    expect(html).toContain('<figure class="media-img">')
    expect(html).toContain('alt="Rampart"')
    expect(html).toContain('loading="lazy"')
  })

  it('falls back to an image for unknown extensions', () => {
    const html = renderMediaHtml('/tours/x/thing.xyz', 'Thing', '/')
    expect(html).toContain('<figure class="media-img">')
  })

  it('applies the base path to media src', () => {
    const html = renderMediaHtml('/tours/x/rampart.png', 'Rampart', '/tour-guide/')
    expect(html).toContain('src="/tour-guide/tours/x/rampart.png"')
  })

  it('escapes captions and srcs in attribute positions', () => {
    const html = renderMediaHtml('/tours/x/a.png', `He said "hello" & <waved>`, '/')
    expect(html).toContain('alt="He said &quot;hello&quot; &amp; &lt;waved&gt;"')
    expect(html).not.toContain('<waved>')
  })
})
