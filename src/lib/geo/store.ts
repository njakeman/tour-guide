import { writable, readable, derived, type Readable, type Writable } from 'svelte/store'

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
 * Haversine distance between two lat/lng points in meters
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371e3 // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

/**
 * Svelte store that tracks browser geolocation
 */
function createGeolocationStore(): Writable<GeoState> {
  const store = writable<GeoState>({
    position: null,
    error: null,
    loading: true,
    available: 'geolocation' in navigator,
  })

  if (!('geolocation' in navigator)) {
    store.update((s) => ({ ...s, loading: false }))
    return store
  }

  let watchId: number | null = null

  function startWatching() {
    store.update((s) => ({ ...s, loading: true, error: null }))

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        store.update((s) => ({
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
      },
      (err) => {
        store.update((s) => ({
          ...s,
          error: { code: err.code, message: err.message },
          loading: false,
        }))
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30000,
        timeout: 10000,
      }
    )
  }

  function stopWatching() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId)
      watchId = null
    }
  }

  // Auto-start watching
  startWatching()

  return {
    subscribe: store.subscribe,
    set: store.set,
    update: store.update,
  }
}

export const geolocation = createGeolocationStore()

/**
 * Derived store that calculates distances to each stop and identifies nearest
 */
export function createProximityStore(stops: Readable<{ lat: number | null; lng: number | null; id: string }[]>) {
  return derived(
    [geolocation, stops],
    ([$geo, $stops]) => {
      if (!$geo.position || !$stops) {
        return { distances: {}, nearestStopId: null }
      }

      const distances: Record<string, number> = {}
      let nearestStopId: string | null = null
      let minDistance = Infinity

      for (const stop of $stops) {
        if (stop.lat !== null && stop.lng !== null) {
          const d = haversineDistance(
            $geo.position.lat,
            $geo.position.lng,
            stop.lat,
            stop.lng
          )
          distances[stop.id] = Math.round(d)

          if (d < minDistance) {
            minDistance = d
            nearestStopId = stop.id
          }
        }
      }

      return { distances, nearestStopId, minDistance }
    }
  )
}
