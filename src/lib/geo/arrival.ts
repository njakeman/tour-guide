/**
 * Arrival detection — pure logic for the "you've reached a stop" moment.
 * App.svelte runs this over each proximity update while a tour is open;
 * one-shot per stop per session (the caller records announced ids).
 */
import { isNearby, type ProximityResult } from './store'

type StopLike = { id: string; proximity_radius: number }

/**
 * The id of a stop the walker has just arrived at, or null.
 *
 * Fires only for the nearest stop, only when the fix is inside that stop's
 * radius with acceptable accuracy (same `isNearby` contract as the footer's
 * "arriving" state), and only once per stop (`announced`).
 */
export function detectArrival(
  proximity: ProximityResult,
  stops: StopLike[],
  accuracy: number | undefined,
  announced: ReadonlySet<string>
): string | null {
  const id = proximity.nearestStopId
  if (!id || accuracy === undefined || announced.has(id)) return null
  const stop = stops.find((s) => s.id === id)
  if (!stop) return null
  const distance = proximity.distances[id]
  if (distance === undefined) return null
  return isNearby(distance, stop.proximity_radius, accuracy) ? id : null
}
