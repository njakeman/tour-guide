/**
 * Hash-based routing, extracted from App.svelte so it can be unit-tested.
 *
 *   #/                        → library
 *   #/route                   → route overview
 *   #stop=<stopId>&route=<id> → stop view
 */

export type View = 'library' | 'route' | 'stop'

export type ParsedHash = {
  view: View
  stopId?: string
  routeId?: string
}

export function parseHash(hash: string): ParsedHash {
  if (hash.startsWith('#stop=')) {
    const [stopId, routeId] = hash.slice(6).split('&route=')
    return {
      view: 'stop',
      stopId: stopId || undefined,
      routeId: routeId || undefined,
    }
  }
  if (hash === '#/route') return { view: 'route' }
  return { view: 'library' }
}

export function buildHash(view: View, stopId?: string, routeId?: string): string {
  if (view === 'stop' && stopId) return `#stop=${stopId}&route=${routeId ?? ''}`
  if (view === 'route') return '#/route'
  return '#/'
}
