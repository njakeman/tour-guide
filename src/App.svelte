<script lang="ts">
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { writable } from 'svelte/store'
  import { routes } from 'virtual:tour-content'
  import type { TourStop } from './lib/types'
  import { geolocation, createProximityStore } from './lib/geo/store'
  import TourLibrary from './lib/TourLibrary.svelte'
  import RouteMap from './lib/RouteMap.svelte'
  import TourStopView from './lib/TourStop.svelte'

  // ── Routing ──────────────────────────────────────────────────────────────
  type View = 'library' | 'route' | 'stop'

  function parseHash(): { view: View; stopId?: string; routeId?: string } {
    const h = window.location.hash
    if (h.startsWith('#stop=')) {
      const parts = h.slice(6).split('&route=')
      return { view: 'stop', stopId: parts[0], routeId: parts[1] }
    }
    if (h === '#/route') return { view: 'route' }
    return { view: 'library' }
  }

  const initial = parseHash()

  // ── State ─────────────────────────────────────────────────────────────────
  let view = $state<View>(initial.view)
  let selectedRouteId = $state<string>(initial.routeId ?? routes[0]?.id ?? '')
  let currentStopIndex = $state<number>(0)

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentRoute = $derived(
    routes.find((r) => r.id === selectedRouteId) ?? routes[0]
  )

  const currentStop = $derived(currentRoute?.stops[currentStopIndex])

  // Initialise stop index from hash (runs once after route is resolved)
  $effect(() => {
    if (initial.stopId && currentRoute) {
      const idx = currentRoute.stops.findIndex((s: TourStop) => s.id === initial.stopId)
      if (idx >= 0) currentStopIndex = idx
    }
  })

  // Track visited stops within the session
  // SvelteSet.add() mutates in place — no read-then-reassign, no infinite loop
  const visited = new SvelteSet<string>()
  $effect(() => {
    if (view === 'stop' && currentStop?.id) visited.add(currentStop.id)
  })

  // ── Hash management ───────────────────────────────────────────────────────
  function setHash(v: View, stopId?: string) {
    const newHash =
      v === 'stop' && stopId
        ? `#stop=${stopId}&route=${selectedRouteId}`
        : v === 'route'
          ? '#/route'
          : '#/'
    if (window.location.hash !== newHash) {
      window.location.hash = newHash
    }
  }

  // ── Navigation handlers ───────────────────────────────────────────────────
  function goLibrary() {
    view = 'library'
    setHash('library')
  }

  function goRoute() {
    view = 'route'
    setHash('route')
  }

  function goStop(idx: number) {
    if (!currentRoute) return
    const stop = currentRoute.stops[idx]
    if (!stop) return
    currentStopIndex = idx
    view = 'stop'
    setHash('stop', stop.id)
  }

  function goStopById(stopId: string) {
    if (!currentRoute) return
    const idx = currentRoute.stops.findIndex((s: TourStop) => s.id === stopId)
    if (idx >= 0) goStop(idx)
  }

  function selectRoute(routeId: string) {
    selectedRouteId = routeId
    currentStopIndex = 0
    view = 'route'
    setHash('route')
  }

  function handleHashChange() {
    const parsed = parseHash()
    view = parsed.view
    if (parsed.routeId && parsed.routeId !== selectedRouteId) {
      selectedRouteId = parsed.routeId
    }
    if (parsed.stopId) {
      // Resolve route inline to avoid the $derived-in-closure warning
      const route = routes.find((r) => r.id === selectedRouteId) ?? routes[0]
      if (route) {
        const idx = route.stops.findIndex((s: TourStop) => s.id === parsed.stopId)
        if (idx >= 0) currentStopIndex = idx
      }
    }
  }

  onMount(() => {
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  })

  // ── Proximity ─────────────────────────────────────────────────────────────
  // Bridge between Svelte 5 runes (currentRoute) and Svelte 4 store API
  const stopsStore = writable<TourStop[]>(currentRoute?.stops ?? [])
  $effect(() => { stopsStore.set(currentRoute?.stops ?? []) })
  const proximity = createProximityStore(stopsStore)

  const currentDist = $derived(
    currentStop ? $proximity.distances[currentStop.id] : undefined
  )
  const geoAccuracy = $derived($geolocation.position?.accuracy)
</script>

<div id="fw-app">
  {#if view === 'library'}
    <TourLibrary {routes} onSelect={selectRoute} />

  {:else if view === 'route' && currentRoute}
    <RouteMap
      route={currentRoute}
      currentStopId={currentStop?.id ?? null}
      visitedStopIds={visited}
      onBack={goLibrary}
      onGoToStop={goStopById}
    />

  {:else if view === 'stop' && currentStop && currentRoute}
    <TourStopView
      stop={currentStop}
      stopIndex={currentStopIndex}
      totalStops={currentRoute.stops.length}
      routeName={currentRoute.name}
      distanceMetres={currentDist}
      accuracy={geoAccuracy}
      onPrev={() => goStop(currentStopIndex - 1)}
      onNext={() => goStop(currentStopIndex + 1)}
      onBack={goRoute}
    />

  {:else}
    <TourLibrary {routes} onSelect={selectRoute} />
  {/if}
</div>

<style>
  #fw-app {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
  }
</style>
