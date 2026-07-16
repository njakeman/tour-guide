import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  haversineDistance,
  isNearby,
  createProximityStore,
  geolocation,
  setGeoAccuracyMode,
  type GeoState,
} from './store'
import { writable, get } from 'svelte/store'

function geoStateWithPosition(lat: number, lng: number, accuracy = 10): GeoState {
  return {
    position: { lat, lng, accuracy, timestamp: Date.now() },
    error: null,
    loading: false,
    available: true,
  }
}

// ---------------------------------------------------------------------------
// haversineDistance
// ---------------------------------------------------------------------------
describe('haversineDistance', () => {
  it('calculates distance from Cissbury Ring to Chanctonbury Ring', () => {
    const cissbury = { lat: 50.8561, lng: -0.3790 }
    const chanctonbury = { lat: 50.8967, lng: -0.4389 }
    const d = haversineDistance(cissbury.lat, cissbury.lng, chanctonbury.lat, chanctonbury.lng)
    expect(d).toBeGreaterThan(4000)
    expect(d).toBeLessThan(7000)
  })

  it('returns 0 for the same point', () => {
    expect(haversineDistance(50.8561, -0.379, 50.8561, -0.379)).toBe(0)
  })

  it('calculates small distances accurately (~100m)', () => {
    const d = haversineDistance(50.8561, -0.379, 50.8561, -0.378)
    expect(d).toBeGreaterThan(50)
    expect(d).toBeLessThan(150)
  })

  it('handles negative coordinates (Southern Hemisphere)', () => {
    const d = haversineDistance(-33.8688, 151.2093, -37.8136, 144.9631)
    expect(d).toBeGreaterThan(700_000)
    expect(d).toBeLessThan(800_000)
  })
})

// ---------------------------------------------------------------------------
// isNearby — accuracy-aware
// ---------------------------------------------------------------------------
describe('isNearby', () => {
  it('returns true when inside radius with good accuracy', () => {
    expect(isNearby(20, 30, 10)).toBe(true)
  })

  it('returns false when outside radius', () => {
    expect(isNearby(50, 30, 10)).toBe(false)
  })

  it('returns false when accuracy is worse than 2× radius', () => {
    // distance = 20, radius = 30 (would be "nearby" without accuracy check)
    // but accuracy = 80 > 30*2 = 60 → not confident enough
    expect(isNearby(20, 30, 80)).toBe(false)
  })

  it('returns true at the edge of the accuracy window', () => {
    // accuracy = 60 (exactly 2× radius of 30) → still ok
    expect(isNearby(25, 30, 60)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// createProximityStore
// ---------------------------------------------------------------------------
describe('createProximityStore', () => {
  beforeEach(() => {
    // Mock navigator.geolocation so the singleton store doesn't blow up in jsdom
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn(),
        watchPosition: vi.fn(() => 1),
        clearWatch: vi.fn(),
      },
    })
  })

  it('returns empty distances when no GPS position', () => {
    const stops = writable([
      { id: 'a', lat: 50.8561, lng: -0.379, proximity_radius: 30 },
    ])
    const store = createProximityStore(stops)
    const result = get(store)
    expect(result.distances).toEqual({})
    expect(result.nearestStopId).toBeNull()
  })

  it('calculates distances and picks the nearest stop', () => {
    const geo = writable<GeoState>(geoStateWithPosition(50.8561, -0.379))
    const stops = writable([
      { id: 'near', lat: 50.8561, lng: -0.379, proximity_radius: 30 },
      { id: 'far', lat: 50.8967, lng: -0.4389, proximity_radius: 30 },
    ])
    const store = createProximityStore(stops, geo)
    const result = get(store)

    expect(result.nearestStopId).toBe('near')
    expect(result.distances.near).toBe(0)
    expect(result.distances.far).toBeGreaterThan(4000)
    expect(result.minDistance).toBe(0)
  })

  it('skips stops without coordinates', () => {
    const geo = writable<GeoState>(geoStateWithPosition(50.8561, -0.379))
    const stops = writable([
      { id: 'no-coords', lat: null, lng: null, proximity_radius: 30 },
      { id: 'here', lat: 50.8561, lng: -0.379, proximity_radius: 30 },
    ])
    const store = createProximityStore(stops, geo)
    const result = get(store)

    expect(result.distances['no-coords']).toBeUndefined()
    expect(result.nearestStopId).toBe('here')
  })

  it('updates when the GPS position moves', () => {
    const geo = writable<GeoState>(geoStateWithPosition(50.8561, -0.379))
    const stops = writable([
      { id: 'entrance', lat: 50.8561, lng: -0.379, proximity_radius: 30 },
      { id: 'summit', lat: 50.8967, lng: -0.4389, proximity_radius: 30 },
    ])
    const store = createProximityStore(stops, geo)

    expect(get(store).nearestStopId).toBe('entrance')
    geo.set(geoStateWithPosition(50.8967, -0.4389))
    expect(get(store).nearestStopId).toBe('summit')
  })
})

// ---------------------------------------------------------------------------
// geolocation store lifecycle
// ---------------------------------------------------------------------------
describe('geolocation store', () => {
  it('starts the GPS watch on first subscribe and clears it on last unsubscribe', () => {
    const watchPosition = vi.fn(() => 42)
    const clearWatch = vi.fn()
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: vi.fn(), watchPosition, clearWatch },
    })

    const unsubA = geolocation.subscribe(() => {})
    const unsubB = geolocation.subscribe(() => {})
    expect(watchPosition).toHaveBeenCalledTimes(1)

    unsubA()
    expect(clearWatch).not.toHaveBeenCalled()

    unsubB()
    expect(clearWatch).toHaveBeenCalledWith(42)
  })

  it('reports unavailable without blowing up when geolocation is missing', () => {
    // @ts-expect-error — simulate a browser without the Geolocation API
    delete navigator.geolocation

    let state: GeoState | undefined
    const unsub = geolocation.subscribe((s) => { state = s })
    expect(state!.available).toBe(false)
    expect(state!.loading).toBe(false)
    unsub()
  })
})

// ---------------------------------------------------------------------------
// Accuracy mode — low on the library, high once a tour is open
// ---------------------------------------------------------------------------
describe('setGeoAccuracyMode', () => {
  let watchPosition: ReturnType<typeof vi.fn>
  let clearWatch: ReturnType<typeof vi.fn>
  let nextWatchId: number

  beforeEach(() => {
    nextWatchId = 1
    watchPosition = vi.fn(() => nextWatchId++)
    clearWatch = vi.fn()
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: vi.fn(), watchPosition, clearWatch },
    })
  })

  // The mode is module-level state shared across tests — always reset
  afterEach(() => setGeoAccuracyMode('low'))

  it('starts the watch in low-accuracy mode by default', () => {
    const unsub = geolocation.subscribe(() => {})
    expect(watchPosition).toHaveBeenCalledTimes(1)
    expect(watchPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: false })
    unsub()
  })

  it('restarts a running watch when the mode changes', () => {
    const unsub = geolocation.subscribe(() => {})
    setGeoAccuracyMode('high')

    expect(clearWatch).toHaveBeenCalledWith(1)
    expect(watchPosition).toHaveBeenCalledTimes(2)
    expect(watchPosition.mock.calls[1][2]).toMatchObject({ enableHighAccuracy: true })

    // Teardown clears the NEW watch id, not the stale one
    unsub()
    expect(clearWatch).toHaveBeenLastCalledWith(2)
  })

  it('does not restart when set to the current mode', () => {
    const unsub = geolocation.subscribe(() => {})
    setGeoAccuracyMode('low')
    expect(clearWatch).not.toHaveBeenCalled()
    expect(watchPosition).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('applies a mode set while unsubscribed to the next watch', () => {
    setGeoAccuracyMode('high')
    expect(watchPosition).not.toHaveBeenCalled()

    const unsub = geolocation.subscribe(() => {})
    expect(watchPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: true })
    unsub()
  })

  it('mode change after unsubscribe does not touch the cleared watch', () => {
    const unsub = geolocation.subscribe(() => {})
    unsub()
    clearWatch.mockClear()
    setGeoAccuracyMode('high')
    expect(clearWatch).not.toHaveBeenCalled()
    expect(watchPosition).toHaveBeenCalledTimes(1)
  })
})
