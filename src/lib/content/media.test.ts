import { describe, it, expect } from 'vitest'
import { resolve } from 'path'
import {
  withBase,
  escapeHtml,
  renderMediaHtml,
  probeImage,
  startMediaCollection,
  drainMediaCollection,
} from './vite-plugin'

// Committed fixtures: sample.png (8×6) with a .webp sibling, nowebp.png (4×3)
const FIXTURES = resolve(__dirname, '__fixtures__')

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

  it('renders a plain <img> without dimensions when the file is not on disk', () => {
    const html = renderMediaHtml('/tours/x/missing.png', 'Gone', '/', FIXTURES)
    expect(html).toContain('<img src="/tours/x/missing.png"')
    expect(html).not.toContain('<picture>')
    expect(html).not.toContain('width=')
  })

  it('adds intrinsic dimensions and decoding="async" for a probeable image', () => {
    const html = renderMediaHtml('/nowebp.png', 'Plain', '/', FIXTURES)
    expect(html).toContain('decoding="async"')
    expect(html).toContain('width="4" height="3"')
    expect(html).not.toContain('<picture>')
  })

  it('upgrades to <picture> when a .webp sibling exists, sized from the webp', () => {
    const html = renderMediaHtml('/sample.png', 'Variant', '/', FIXTURES)
    expect(html).toContain('<picture><source type="image/webp" srcset="/sample.webp" />')
    expect(html).toContain('<img src="/sample.png"')
    expect(html).toContain('width="8" height="6"')
    expect(html).toContain('</picture>')
  })

  it('applies the base path to the webp srcset too', () => {
    const html = renderMediaHtml('/sample.png', 'Variant', '/tour-guide/', FIXTURES)
    expect(html).toContain('srcset="/tour-guide/sample.webp"')
    expect(html).toContain('src="/tour-guide/sample.png"')
  })
})

describe('media collection (offline manifest)', () => {
  it('collects the effective URL — webp when the sibling exists, original otherwise', () => {
    startMediaCollection()
    renderMediaHtml('/sample.png', 'With variant', '/', FIXTURES)
    renderMediaHtml('/nowebp.png', 'No variant', '/', FIXTURES)
    renderMediaHtml('/tours/x/narration.mp3', 'Audio', '/', FIXTURES)
    renderMediaHtml('/tours/x/fort.glb', 'Model', '/', FIXTURES)
    expect(drainMediaCollection().sort()).toEqual([
      '/nowebp.png',
      '/sample.webp',
      '/tours/x/fort.glb',
      '/tours/x/narration.mp3',
    ])
  })

  it('dedupes repeated references and collects nothing when not started', () => {
    startMediaCollection()
    renderMediaHtml('/nowebp.png', 'a', '/', FIXTURES)
    renderMediaHtml('/nowebp.png', 'b', '/', FIXTURES)
    expect(drainMediaCollection()).toEqual(['/nowebp.png'])

    // Not started → renders must not leak into a stale collector
    renderMediaHtml('/nowebp.png', 'c', '/', FIXTURES)
    expect(drainMediaCollection()).toEqual([])
  })
})

describe('probeImage', () => {
  it('ignores external URLs and data URIs', () => {
    expect(probeImage('https://example.com/a.png', FIXTURES)).toEqual({})
    expect(probeImage('//cdn.example.com/a.png', FIXTURES)).toEqual({})
    expect(probeImage('data:image/png;base64,AAA', FIXTURES)).toEqual({})
  })

  it('returns dimensions and the webp sibling for a matched pair', () => {
    expect(probeImage('/sample.png', FIXTURES)).toEqual({
      width: 8,
      height: 6,
      webpHref: '/sample.webp',
    })
  })

  it('returns dimensions only when no sibling exists', () => {
    expect(probeImage('/nowebp.png', FIXTURES)).toEqual({ width: 4, height: 3 })
  })

  it('returns empty for missing files', () => {
    expect(probeImage('/missing.png', FIXTURES)).toEqual({})
  })
})
