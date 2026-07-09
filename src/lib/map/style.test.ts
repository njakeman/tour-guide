import { describe, it, expect } from 'vitest'
import type { StyleSpecification } from 'maplibre-gl'
import {
  buildMapStyle,
  mapZoomRange,
  isFatalMapError,
  BASEMAP_SOURCE_ID,
  TOUR_BASEMAP_ATTRIBUTION,
  BASE_STYLE_ATTRIBUTION,
} from './style'

const BASEMAP_URL = '/tours/wolstonbury-hill/wolstonbury_v5.pmtiles'

/** Small stand-in for fieldworks-minimal.style.json (same source ids/shape). */
function fixtureBaseStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      ne2_shaded: {
        type: 'raster',
        maxzoom: 6,
        tileSize: 256,
        tiles: ['https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'],
      },
      openmaptiles: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
      },
    },
    sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    layers: [
      { id: 'background', type: 'background' },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
      { id: 'label_country_1', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place' },
    ],
  }
}

describe('buildMapStyle — pmtiles-only', () => {
  it('produces the original single-source raster style', () => {
    const style = buildMapStyle(BASEMAP_URL, null)
    expect(style.version).toBe(8)
    expect(Object.keys(style.sources)).toEqual([BASEMAP_SOURCE_ID])
    const src = style.sources[BASEMAP_SOURCE_ID] as Record<string, unknown>
    expect(src.type).toBe('raster')
    expect(src.url).toBe(`pmtiles://${BASEMAP_URL}`)
    expect(src.tileSize).toBe(256)
    expect(src.attribution).toBe(TOUR_BASEMAP_ATTRIBUTION)
    expect(style.layers).toEqual([
      { id: BASEMAP_SOURCE_ID, type: 'raster', source: BASEMAP_SOURCE_ID },
    ])
  })
})

describe('buildMapStyle — merged with the OpenFreeMap base', () => {
  it('keeps all base sources and appends the tour raster layer LAST', () => {
    const style = buildMapStyle(BASEMAP_URL, fixtureBaseStyle())
    expect(Object.keys(style.sources).sort()).toEqual(
      ['basemap', 'ne2_shaded', 'openmaptiles'].sort()
    )
    // Base layers first, tour raster on top
    expect(style.layers.map((l) => l.id)).toEqual([
      'background',
      'water',
      'label_country_1',
      BASEMAP_SOURCE_ID,
    ])
    expect(style.layers.at(-1)).toEqual({
      id: BASEMAP_SOURCE_ID,
      type: 'raster',
      source: BASEMAP_SOURCE_ID,
    })
    // sprite/glyphs must survive (8 OFM layers use icon-image)
    expect(style.sprite).toBe('https://tiles.openfreemap.org/sprites/ofm_f384/ofm')
    expect(style.glyphs).toBe('https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf')
  })

  it('adds the required OpenFreeMap attribution to both base sources', () => {
    const style = buildMapStyle(BASEMAP_URL, fixtureBaseStyle())
    const om = style.sources.openmaptiles as Record<string, unknown>
    const ne = style.sources.ne2_shaded as Record<string, unknown>
    expect(om.attribution).toBe(BASE_STYLE_ATTRIBUTION)
    expect(ne.attribution).toBe(BASE_STYLE_ATTRIBUTION)
    const basemap = style.sources[BASEMAP_SOURCE_ID] as Record<string, unknown>
    expect(basemap.attribution).toBe(TOUR_BASEMAP_ATTRIBUTION)
  })

  it('never mutates the input base style (dynamic imports share one instance)', () => {
    const base = fixtureBaseStyle()
    const before = JSON.stringify(base)
    const style = buildMapStyle(BASEMAP_URL, base)
    expect(JSON.stringify(base)).toBe(before)
    expect(style).not.toBe(base)
    expect(style.layers).not.toBe(base.layers)
    expect(style.sources).not.toBe(base.sources)
  })
})

describe('mapZoomRange', () => {
  it('relaxes minZoom for the base style, keeps the tileset clamp without', () => {
    expect(mapZoomRange(true)).toEqual({ minZoom: 5, maxZoom: 17 })
    expect(mapZoomRange(false)).toEqual({ minZoom: 12, maxZoom: 17 })
  })
})

describe('isFatalMapError', () => {
  it('pmtiles-only: every pre-load error is fatal (original behaviour)', () => {
    expect(isFatalMapError({ sourceId: 'basemap' }, false)).toBe(true)
    expect(isFatalMapError({ error: new Error('boom') }, false)).toBe(true)
    expect(isFatalMapError(undefined, false)).toBe(true)
  })

  it('merged: fatal only when attributable to the tour basemap source', () => {
    expect(isFatalMapError({ sourceId: 'basemap' }, true)).toBe(true)
    // OpenFreeMap failures must never take down a healthy pmtiles map
    expect(isFatalMapError({ sourceId: 'openmaptiles' }, true)).toBe(false)
    expect(isFatalMapError({ sourceId: 'ne2_shaded' }, true)).toBe(false)
    // Sprite failures / validation errors carry no sourceId — fail open
    expect(isFatalMapError({ error: new TypeError('Failed to fetch') }, true)).toBe(false)
    expect(isFatalMapError(undefined, true)).toBe(false)
  })
})
