/**
 * Map style construction for MapPanel — pure functions, unit-tested in jsdom.
 *
 * Two modes:
 * - pmtiles-only: the original single-source raster style (offline path).
 * - merged: the OpenFreeMap base style (fieldworks-minimal.style.json — vector
 *   `openmaptiles` + low-zoom `ne2_shaded` raster on tiles.openfreemap.org)
 *   with the tour's pmtiles raster appended LAST so it paints on top. The base
 *   shows through outside the tileset's bounds/zooms: the pmtiles protocol
 *   serves TileJSON carrying the header's minzoom/maxzoom/bounds, and MapLibre
 *   never requests raster tiles outside them — no manual layer minzoom needed.
 *
 * The base style is network-only (cross-origin tiles match no SW cache rule),
 * so MapPanel only includes it when the `online` store says we're connected.
 */

// Type-only imports — erased at build time, no maplibre in the main chunk.
import type {
  StyleSpecification,
  RasterSourceSpecification,
  SourceSpecification,
} from 'maplibre-gl'
import type { TourRoute } from '../types'

export const BASEMAP_SOURCE_ID = 'basemap'
export const ROUTE_LINE_SOURCE_ID = 'route-line'

export const TOUR_BASEMAP_ATTRIBUTION =
  '© Environment Agency, © OpenStreetMap contributors'

/** Required credit for the OpenFreeMap base (the style JSON ships without one). */
export const BASE_STYLE_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'

function tourBasemapSource(basemapUrl: string): RasterSourceSpecification {
  return {
    type: 'raster',
    url: `pmtiles://${basemapUrl}`,
    tileSize: 256,
    attribution: TOUR_BASEMAP_ATTRIBUTION,
  }
}

/**
 * Build the MapLibre style for a tour map.
 *
 * @param basemapUrl the tour's pmtiles URL (route.map.basemap)
 * @param baseStyle  the OpenFreeMap base style to layer underneath, or null
 *                   for the pmtiles-only style (offline / base unavailable).
 *                   Never mutated — dynamic imports share one module instance.
 */
export function buildMapStyle(
  basemapUrl: string,
  baseStyle: StyleSpecification | null = null
): StyleSpecification {
  if (!baseStyle) {
    return {
      version: 8,
      sources: {
        [BASEMAP_SOURCE_ID]: tourBasemapSource(basemapUrl),
      },
      layers: [
        {
          id: BASEMAP_SOURCE_ID,
          type: 'raster',
          source: BASEMAP_SOURCE_ID,
        },
      ],
    }
  }

  const style = structuredClone(baseStyle)

  // The OFM style carries no attribution — add the required credit to both of
  // its sources so it shows whichever one is in view.
  for (const id of ['openmaptiles', 'ne2_shaded']) {
    const source = style.sources[id] as (SourceSpecification & { attribution?: string }) | undefined
    if (source) source.attribution = BASE_STYLE_ATTRIBUTION
  }

  // Tour raster last: paints on top; no layer maxzoom (it is exclusive — 17
  // would hide the raster at exactly the map's max zoom).
  style.sources[BASEMAP_SOURCE_ID] = tourBasemapSource(basemapUrl)
  style.layers.push({
    id: BASEMAP_SOURCE_ID,
    type: 'raster',
    source: BASEMAP_SOURCE_ID,
  })

  return style
}

/**
 * Map-level zoom clamps. With the base style the user may zoom out past the
 * tileset for context (ne2_shaded covers low zooms; the vector overzooms);
 * pmtiles-only clamps to the tilesets' 12–17 floor — below z12 the tour
 * tilesets have no tiles, so allowing it offline would show a blank frame.
 */
export function mapZoomRange(hasBaseStyle: boolean): { minZoom: number; maxZoom: number } {
  return hasBaseStyle ? { minZoom: 5, maxZoom: 17 } : { minZoom: 12, maxZoom: 17 }
}

/**
 * Should a pre-reveal map 'error' event drop the panel to the SVG fallback?
 *
 * pmtiles-only: yes, always — the original behaviour (basemap 404, offline
 * with a cold cache).
 *
 * Merged: only when the error is attributable to the tour basemap source.
 * Source-scoped failures (TileJSON, tile, glyph) carry `sourceId`; OpenFreeMap
 * failures must never take down a healthy pmtiles map. Sprite failures carry
 * NO sourceId (and a network-down sprite error is a bare TypeError with no
 * URL), so unattributed errors fail open — safe, because the reveal is gated
 * on the basemap source (isBasemapRenderableEvent), not on `load`: a dead or
 * hung OFM CAN wedge `load` (Style.loaded() waits on every source and the
 * sprite), but the healthy pmtiles source still reveals via `sourcedata`; if
 * it is broken, its error arrives with `sourceId: 'basemap'` and we fall back
 * as before.
 */
export function isFatalMapError(e: unknown, hasBaseStyle: boolean): boolean {
  if (!hasBaseStyle) return true
  return (e as { sourceId?: string } | null)?.sourceId === BASEMAP_SOURCE_ID
}

/**
 * GeoJSON for the walking-route line drawn on the live map.
 *
 * Prefers the authored path (map.routeLine from content/routes/<id>/
 * route.geojson); falls back to a straight line through the stops that have
 * coordinates; null when fewer than 2 points exist (nothing to draw).
 */
export function buildRouteLineData(
  route: TourRoute
): { type: 'Feature'; properties: Record<string, never>; geometry: { type: 'LineString'; coordinates: [number, number][] } } | null {
  const coords: [number, number][] =
    route.map?.routeLine ??
    route.stops
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => [s.lng as number, s.lat as number])
  if (coords.length < 2) return null
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: coords },
  }
}

/**
 * Should the "reset to north" control show? True once the map has been
 * rotated or tilted off its default 2D north-up view. A small epsilon
 * avoids flicker from the rest position's floating-point noise.
 */
export function isOffNorth(bearing: number, pitch: number): boolean {
  return Math.abs(bearing) > 0.5 || pitch > 0.5
}

/**
 * Is this map event the "tour basemap is renderable" reveal signal?
 *
 * `sourcedata` is per-source: MapLibre attaches `isSourceLoaded` from that
 * source's own TileManager, so sprite/glyph/other-source fetches play no
 * part. `isSourceLoaded: true` means the TileJSON arrived and every in-view
 * tile is loaded/errored — the tour raster is renderable even while
 * OpenFreeMap requests hang (which would block `load` indefinitely).
 */
export function isBasemapRenderableEvent(e: unknown): boolean {
  const ev = e as
    | { dataType?: string; sourceId?: string; isSourceLoaded?: boolean }
    | null
    | undefined
  return (
    !!ev &&
    ev.dataType === 'source' &&
    ev.sourceId === BASEMAP_SOURCE_ID &&
    ev.isSourceLoaded === true
  )
}
