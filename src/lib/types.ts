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
  stops: TourStop[]
}
