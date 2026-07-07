import { writable, derived, type Readable } from 'svelte/store'

export type GeoPosition = {
  lat: number
  lng: number
  accuracy: number
  timestamp: number
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
 * Returns true when the user is within `radius` metres of a stop,
 * and the GPS accuracy is good enough to be meaningful
 * (accuracy must be < 2× the radius).
 */
export function isNearby(distance: number, radius: number, accuracy: number): boolean {
  if (accuracy > radius * 2) return false
  return distance <= radius
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

      const opts: PositionOptions = {
        enableHighAccuracy: true,
        maximumAge: 30_000,
        timeout: 10_000,
      }

      function onSuccess(pos: GeolocationPosition) {
        update((s) => ({
          ...s,
          position: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp,
          },
          loading: false,
          error: null,
        }))
      }

      function onError(err: GeolocationPositionError) {
        update((s) => ({
          ...s,
          error: { code: err.code, message: err.message },
          loading: false,
        }))
      }

      // Fast seed: get an immediate fix, then watch for updates
      navigator.geolocation.getCurrentPosition(onSuccess, onError, opts)
      const watchId = navigator.geolocation.watchPosition(onSuccess, onError, opts)

      return () => navigator.geolocation.clearWatch(watchId)
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
