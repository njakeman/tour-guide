/**
 * Single source of truth for all content types.
 * Used by the Vite plugin (build time) and Svelte components (runtime).
 */

export type MediaItem = {
  /** Determines the element used to render this media */
  type: 'image' | 'audio' | 'video' | 'model'
  src: string
  caption?: string
}

export type HeroImage = {
  src: string
  caption?: string
  /** Intrinsic dimensions probed at build time (of the rendered variant) */
  width?: number
  height?: number
  /** Base-path-rewritten URL of the build-generated .webp variant, if any */
  webpSrc?: string
}

/**
 * A single interpretive stop on a tour.
 * All stop data is resolved at build time by the Vite content plugin.
 */
export type TourStop = {
  id: string
  title: string
  /** Short era label, e.g. "Iron Age hillfort · c. 400 BC" */
  era?: string
  /** OS grid reference, e.g. "TQ 139 080" */
  grid_ref?: string
  /** Elevation above datum, e.g. "184m AOD" */
  elevation?: string
  /** Estimated walk time from previous stop, e.g. "5 min walk" */
  walk_time?: string
  lat: number | null
  lng: number | null
  /** Arrival radius in metres; default 30 */
  proximity_radius: number
  evidence: string
  interpretation: string
  /** Pre-rendered HTML from the markdown body (media elements already expanded) */
  bodyHtml: string
  /** Frontmatter-declared media items rendered below the body */
  media: MediaItem[]
  /** Main hero plate shown at the top of the stop view */
  hero?: HeroImage
}

/**
 * Build-time inventory of everything a tour needs offline beyond the app
 * shell. Drives the "Save tour offline"/"Save all" warm-up buttons — sizes
 * are statted from public/ at build, so the UI shows real numbers without
 * runtime HEAD requests. Files missing at build time (e.g. dev without
 * `npm run demo:seed`) are omitted, so warming never 404s.
 */
export type OfflineManifest = {
  /** Base-path-rewritten media URLs to warm (webp variant preferred when it exists) */
  mediaUrls: string[]
  mediaBytes: number
  /** Size of the pmtiles basemap; 0 when the tour has no basemap */
  basemapBytes: number
}

/**
 * Optional basemap configuration for a tour route.
 * The basemap URL is base-path-rewritten by the content plugin at build time —
 * authors always write /tours/… paths.
 */
export type TourMap = {
  /** Base-path-rewritten URL to a local PMTiles raster basemap */
  basemap: string
  /** [lng, lat] initial centre for the map view */
  center?: [number, number]
  /** Initial zoom level */
  zoom?: number
}

/**
 * A named collection of stops following a route.
 */
export type TourRoute = {
  id: string
  name: string
  /** Short descriptive subtitle shown in cards, e.g. "Iron Age Hillfort · South Downs" */
  subtitle?: string
  description: string
  icon: string
  total_distance?: string
  duration?: string
  /** Optional basemap configuration — drives the MapLibre map on the route overview */
  map?: TourMap
  /** Build-time offline inventory — media URLs + byte sizes for the save-offline UI */
  offline?: OfflineManifest
  stops: TourStop[]
}
