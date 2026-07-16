import { readable } from 'svelte/store'
import { PMTILES_CACHE, TOUR_MEDIA_CACHE } from '../pwa/workbox-config'
import type { TourRoute } from '../types'

/**
 * Real connectivity state — `navigator.onLine` plus online/offline events.
 * `true` means the browser believes it has a network connection.
 */
export const online = readable(
  typeof navigator === 'undefined' ? true : navigator.onLine,
  (set) => {
    if (typeof window === 'undefined') return
    const goOnline = () => set(true)
    const goOffline = () => set(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }
)

function cachesAvailable(): boolean {
  return typeof caches !== 'undefined'
}

/** Whether the full basemap file is already stored in the pmtiles cache. */
export async function isBasemapCached(url: string): Promise<boolean> {
  if (!cachesAvailable()) return false
  try {
    const cache = await caches.open(PMTILES_CACHE)
    return (await cache.match(url)) !== undefined
  } catch {
    return false
  }
}

/**
 * Warm the pmtiles cache with a full-file GET (a 200 response the Cache API
 * can store). The service worker's rangeRequests rule then serves 206 slices
 * from this entry, which is what makes the map work offline — pmtiles' own
 * Range requests produce 206 responses that can never be cached directly.
 *
 * Note the coupling with Workbox's ExpirationPlugin on PMTILES_CACHE
 * (workbox-config.ts): this cache.add() inserts the entry *outside* Workbox,
 * so it has no expiration timestamp until the SW first serves a Range request
 * from it (ExpirationPlugin back-fills one then). Until that first serve the
 * entry is untracked and the maxEntries accounting can be momentarily off —
 * acceptable, but do not "simplify" the warm-up away (see CLAUDE.md).
 */
export async function cacheBasemap(url: string): Promise<void> {
  if (!cachesAvailable()) throw new Error('Cache API unavailable')
  const cache = await caches.open(PMTILES_CACHE)
  if (await cache.match(url)) return
  await cache.add(url)
}

/** Basemap download size in bytes via a HEAD request, or null if unknown. */
export async function basemapSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    if (!res.ok) return null
    const len = res.headers.get('content-length')
    return len ? Number(len) : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Full-tour offline warm-up
// Driven by the build-time OfflineManifest (route.offline): the content
// plugin stats every referenced media file, so sizes are real numbers and no
// runtime HEAD requests are needed. Media warms into TOUR_MEDIA_CACHE (the
// same cache the SW's runtime CacheFirst rule serves from — the names are
// shared via workbox-config so they cannot drift); the basemap goes through
// cacheBasemap into PMTILES_CACHE as before.
// ---------------------------------------------------------------------------

/** Total download size (media + basemap) for the save-offline UI; 0 = nothing to save. */
export function tourOfflineBytes(route: TourRoute): number {
  if (!route.offline) return 0
  return route.offline.mediaBytes + route.offline.basemapBytes
}

/** "850 KB" / "12 MB" — shared by the save buttons. */
export function fmtBytes(bytes: number): string {
  if (bytes >= 1e6) return `${Math.max(1, Math.round(bytes / 1e6))} MB`
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`
}

/** True when everything the tour needs offline (manifest media + basemap) is cached. */
export async function isTourCached(route: TourRoute): Promise<boolean> {
  if (!cachesAvailable()) return false
  if (route.map?.basemap && !(await isBasemapCached(route.map.basemap))) return false
  const urls = route.offline?.mediaUrls ?? []
  if (urls.length === 0) return true
  try {
    const cache = await caches.open(TOUR_MEDIA_CACHE)
    for (const url of urls) {
      if ((await cache.match(url)) === undefined) return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * Warm every cache the tour needs offline: each manifest media URL into
 * TOUR_MEDIA_CACHE (skipping ones already stored), then the basemap via
 * cacheBasemap. Progress is reported by file count (basemap counts as one
 * step). Any failed fetch rejects — the UI offers a retry.
 *
 * Same Workbox-coupling caveat as cacheBasemap: entries inserted here have
 * no ExpirationPlugin timestamp until the SW first serves them, so the
 * maxEntries accounting is momentarily off — acceptable, do not "simplify"
 * the warm-up away.
 */
export async function cacheTourOffline(
  route: TourRoute,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  if (!cachesAvailable()) throw new Error('Cache API unavailable')
  const urls = route.offline?.mediaUrls ?? []
  const hasBasemap = !!route.map?.basemap
  const total = urls.length + (hasBasemap ? 1 : 0)
  let done = 0
  onProgress?.(done, total)

  if (urls.length > 0) {
    const cache = await caches.open(TOUR_MEDIA_CACHE)
    for (const url of urls) {
      if ((await cache.match(url)) === undefined) await cache.add(url)
      onProgress?.(++done, total)
    }
  }
  if (hasBasemap) {
    await cacheBasemap(route.map!.basemap)
    onProgress?.(++done, total)
  }
}
