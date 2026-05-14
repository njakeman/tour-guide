import { describe, it, expect, vi } from 'vitest'
import { haversineDistance } from './store'

describe('haversineDistance', () => {
  it('calculates distance from Cissbury Ring to Chanctonbury Ring', () => {
    // Coordinates from known Sussex landmarks
    const cissbury = { lat: 50.8561, lng: -0.3790 }
    const chanctonbury = { lat: 50.8967, lng: -0.4389 }

    const distance = haversineDistance(
      cissbury.lat,
      cissbury.lng,
      chanctonbury.lat,
      chanctonbury.lng
    )

    // Expected ~5km (approximate driving distance is ~6.5km, straight-line should be ~5km)
    expect(distance).toBeGreaterThan(4000)
    expect(distance).toBeLessThan(7000)
  })

  it('returns 0 for the same point', () => {
    const lat = 50.8561
    const lng = -0.3790

    expect(haversineDistance(lat, lng, lat, lng)).toBe(0)
  })

  it('calculates small distances accurately', () => {
    // Approx 100m apart
    const start = { lat: 50.8561, lng: -0.3790 }
    const end = { lat: 50.8561, lng: -0.3780 }

    const distance = haversineDistance(start.lat, start.lng, end.lat, end.lng)

    expect(distance).toBeGreaterThan(50)
    expect(distance).toBeLessThan(150)
  })

  it('handles negative coordinates (Southern Hemisphere)', () => {
    const sydney = { lat: -33.8688, lng: 151.2093 }
    const melbourne = { lat: -37.8136, lng: 144.9631 }

    const distance = haversineDistance(
      sydney.lat,
      sydney.lng,
      melbourne.lat,
      melbourne.lng
    )

    expect(distance).toBeGreaterThan(700000)
    expect(distance).toBeLessThan(800000)
  })
})
