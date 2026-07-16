import { describe, it, expect } from 'vitest'
import { detectArrival } from './arrival'
import { playArrivalChime, vibrateArrival } from '../arrive/chime'
import type { ProximityResult } from './store'

const stops = [
  { id: 'a', proximity_radius: 30 },
  { id: 'b', proximity_radius: 50 },
]

function prox(nearestStopId: string | null, distance: number): ProximityResult {
  return {
    nearestStopId,
    minDistance: distance,
    distances: nearestStopId ? { [nearestStopId]: distance } : {},
  }
}

describe('detectArrival', () => {
  it('fires when the nearest stop is inside its radius with good accuracy', () => {
    expect(detectArrival(prox('a', 20), stops, 10, new Set())).toBe('a')
  })

  it('respects each stop’s own radius', () => {
    expect(detectArrival(prox('b', 45), stops, 10, new Set())).toBe('b')
    expect(detectArrival(prox('a', 45), stops, 10, new Set())).toBeNull()
  })

  it('does not fire outside the radius', () => {
    expect(detectArrival(prox('a', 80), stops, 10, new Set())).toBeNull()
  })

  it('does not fire with poor accuracy (isNearby contract)', () => {
    // accuracy 100 > 2 × 30m radius
    expect(detectArrival(prox('a', 20), stops, 100, new Set())).toBeNull()
  })

  it('is one-shot: announced stops stay silent', () => {
    expect(detectArrival(prox('a', 20), stops, 10, new Set(['a']))).toBeNull()
  })

  it('handles no fix / unknown stop gracefully', () => {
    expect(detectArrival(prox(null, Infinity), stops, 10, new Set())).toBeNull()
    expect(detectArrival(prox('ghost', 5), stops, 10, new Set())).toBeNull()
    expect(detectArrival(prox('a', 20), stops, undefined, new Set())).toBeNull()
  })
})

describe('arrival feedback (no-throw guards)', () => {
  it('chime and vibration are safe in environments without the APIs', () => {
    // jsdom: no AudioContext, no navigator.vibrate — both must be silent no-ops
    expect(() => playArrivalChime()).not.toThrow()
    expect(() => vibrateArrival()).not.toThrow()
  })
})
