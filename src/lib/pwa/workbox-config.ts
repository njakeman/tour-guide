/**
 * Workbox configuration shared between the build (vite.config.ts) and the
 * runtime offline helpers (src/lib/offline/store.ts). Keeping the cache names
 * and caching rules in one module means the cache the app warms/inspects is
 * guaranteed to be the same one the generated service worker serves from.
 */

/** Cache holding full PMTiles basemap files (Range requests sliced by Workbox). */
export const PMTILES_CACHE = 'pmtiles-basemaps'

/** Runtime cache for other tour media (images, audio, video, models). */
export const TOUR_MEDIA_CACHE = 'tour-media'

type RuntimeCachingEntry = {
  urlPattern: RegExp
  handler: 'CacheFirst'
  options: {
    cacheName: string
    rangeRequests?: boolean
    expiration?: {
      maxEntries?: number
      maxAgeSeconds?: number
    }
  }
}

export type WorkboxOptions = {
  globPatterns: string[]
  globIgnores: string[]
  runtimeCaching: RuntimeCachingEntry[]
}

export const workboxOptions: WorkboxOptions = {
  // Precache the app shell (JS/CSS/HTML) and web fonts.
  globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
  // Tour media must NOT be precached: a real tour's photo set would download
  // in full on first visit and re-download on every content change. It is
  // runtime-cached instead (rules below). PMTiles files never matched the
  // glob, but tour images did — hence the explicit ignore.
  // The marketing/store assets (PWA manifest screenshots, the brand logo) are
  // not part of the runtime app shell, so keep them out of the precache too.
  globIgnores: [
    'tours/**',
    'screenshot-desktop.png',
    'screenshot-mobile.png',
    'henge-bw-logo.png',
  ],
  runtimeCaching: [
    {
      // PMTiles basemaps: CacheFirst with Range-request support.
      // pmtiles always fetches with Range headers, and the Cache API cannot
      // store the resulting 206 responses — so this rule alone never fills
      // the cache. The app warms it with a full-file GET via
      // cacheBasemap() (src/lib/offline/store.ts); Workbox's rangeRequests
      // plugin then serves 206 slices from that cached 200 response offline.
      urlPattern: /\.pmtiles(\?.*)?$/,
      handler: 'CacheFirst',
      options: {
        cacheName: PMTILES_CACHE,
        rangeRequests: true,
        expiration: {
          maxEntries: 10,
          maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
        },
      },
    },
    {
      // Other tour media (images, audio, video) — cached as it is viewed.
      urlPattern: /\/tours\/.+/,
      handler: 'CacheFirst',
      options: {
        cacheName: TOUR_MEDIA_CACHE,
        expiration: {
          maxEntries: 200,
          maxAgeSeconds: 60 * 60 * 24 * 60, // 60 days
        },
      },
    },
  ],
}
