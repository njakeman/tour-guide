import { writable, derived, type Readable } from 'svelte/store'

export type GeoPosition = {
  lat: number
  lng: number
  accuracy: number
  timestamp: number
  /** Device bearing in degrees clockwise from north; null/absent when the
   * platform can't provide one (stationary, no compass, desktop). */
  heading?: number | null
}

export type GeoError = {
  code: number
  message: string
}

export type GeoState = {
  position: GeoPosition | null
  error: GeoError | null
  loading: boolean
  available: boolean
}

/**
 * Haversine great-circle distance between two lat/lng points, in metres.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371e3
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Initial great-circle bearing from point 1 to point 2, in degrees clockwise
 * from north (0–360). Drives the "320m NE ↗" readout in the stop footer.
 */
export function initialBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** 0–360° → 8-wind cardinal ("N", "NE", …). */
export function bearingToCardinal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}

/**
 * Returns true when the user is within `radius` metres of a stop,
 * and the GPS accuracy is good enough to be meaningful
 * (accuracy must be < 2× the radius).
 */
export function isNearby(distance: number, radius: number, accuracy: number): boolean {
  if (accuracy > radius * 2) return false
  return distance <= radius
}

// ---------------------------------------------------------------------------
// Accuracy mode
// The library screen only sorts tours by distance (km apart), so it runs the
// watch in cheap 'low' mode (Wi-Fi/cell positioning). Opening a tour switches
// to 'high' (GNSS) — the walker locator and the 30m stop proximity need it.
// App.svelte drives this from the current view.
// ---------------------------------------------------------------------------
export type GeoAccuracyMode = 'low' | 'high'

let accuracyMode: GeoAccuracyMode = 'low'
/** Set by the store's start notifier while a watch is running. */
let restartWatch: (() => void) | null = null

export function setGeoAccuracyMode(mode: GeoAccuracyMode): void {
  if (mode === accuracyMode) return
  accuracyMode = mode
  // A running watch keeps its options — restart it to apply the new mode.
  restartWatch?.()
}

/**
 * Svelte store that tracks browser geolocation with a fast seed
 * (`getCurrentPosition`) before the continuous `watchPosition`.
 *
 * The watch only runs while the store has subscribers (writable's
 * start/stop notifier): GPS starts on first subscribe and `clearWatch`
 * fires on last unsubscribe, so high-accuracy location never outlives
 * the UI that needs it.
 */
function createGeolocationStore() {
  return writable<GeoState>(
    { position: null, error: null, loading: true, available: false },
    (_set, update) => {
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
        update((s) => ({ ...s, loading: false, available: false }))
        return
      }
      update((s) => ({ ...s, available: true }))

      const optsFor = (): PositionOptions => ({
        enableHighAccuracy: accuracyMode === 'high',
        maximumAge: 30_000,
        timeout: 10_000,
      })

      function onSuccess(pos: GeolocationPosition) {
        update((s) => {
          // The seed getCurrentPosition (maximumAge 30s) can resolve with a
          // cached fix *after* a fresher watch update has already landed —
          // don't let it move the position/timestamp backwards (which would
          // regress the distance or flip a live reading to "stale").
          if (s.position && pos.timestamp < s.position.timestamp) return s
          return {
            ...s,
            position: {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              timestamp: pos.timestamp,
              // Some platforms report NaN while stationary — normalise to null
              heading: Number.isFinite(pos.coords.heading as number)
                ? pos.coords.heading
                : null,
            },
            loading: false,
            error: null,
          }
        })
      }

      function onError(err: GeolocationPositionError) {
        update((s) => ({
          ...s,
          error: { code: err.code, message: err.message },
          loading: false,
        }))
      }

      // Fast seed: get an immediate fix, then watch for updates
      navigator.geolocation.getCurrentPosition(onSuccess, onError, optsFor())
      let watchId = navigator.geolocation.watchPosition(onSuccess, onError, optsFor())

      restartWatch = () => {
        navigator.geolocation.clearWatch(watchId)
        watchId = navigator.geolocation.watchPosition(onSuccess, onError, optsFor())
      }

      return () => {
        restartWatch = null
        navigator.geolocation.clearWatch(watchId)
      }
    }
  )
}

export const geolocation = createGeolocationStore()

// ---------------------------------------------------------------------------
// Derived proximity store
// ---------------------------------------------------------------------------
type StopLike = { id: string; lat: number | null; lng: number | null; proximity_radius: number }

export type ProximityResult = {
  distances: Record<string, number>
  nearestStopId: string | null
  minDistance: number
}

/**
 * Derived store that calculates distances to all stops and identifies the nearest.
 * Pass a Readable<StopLike[]> so this updates whenever either geo or stops change.
 * `geo` is injectable for tests; defaults to the browser geolocation singleton.
 */
export function createProximityStore(
  stops: Readable<StopLike[]>,
  geo: Readable<GeoState> = geolocation
) {
  return derived([geo, stops], ([$geo, $stops]): ProximityResult => {
    if (!$geo.position || !$stops?.length) {
      return { distances: {}, nearestStopId: null, minDistance: Infinity }
    }

    const distances: Record<string, number> = {}
    let nearestStopId: string | null = null
    let minDistance = Infinity

    for (const stop of $stops) {
      if (stop.lat !== null && stop.lng !== null) {
        const d = haversineDistance($geo.position.lat, $geo.position.lng, stop.lat, stop.lng)
        distances[stop.id] = Math.round(d)
        if (d < minDistance) {
          minDistance = d
          nearestStopId = stop.id
        }
      }
    }

    return { distances, nearestStopId, minDistance }
  })
}
