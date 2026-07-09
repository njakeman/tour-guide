<script lang="ts">
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { writable } from 'svelte/store'
  import { routes } from 'virtual:tour-content'
  import type { TourStop } from './lib/types'
  import { geolocation, createProximityStore } from './lib/geo/store'
  import { parseHash, buildHash, type View } from './lib/router'
  import TourLibrary from './lib/TourLibrary.svelte'
  import TourStopView from './lib/TourStop.svelte'

  // ── Routing ──────────────────────────────────────────────────────────────
  const initial = parseHash(window.location.hash)

  // Resolve a deep-linked stop synchronously — an $effect here would re-fire
  // whenever the selected route changes and could jump the stop index if a
  // later route shares a stop id.
  const initialRoute =
    routes.find((r) => r.id === (initial.routeId ?? '')) ?? routes[0]
  const initialStopIndex = initial.stopId && initialRoute
    ? initialRoute.stops.findIndex((s: TourStop) => s.id === initial.stopId)
    : -1

  // ── State ─────────────────────────────────────────────────────────────────
  let view = $state<View>(initial.view)
  // Use the *validated* route id (initialRoute already falls back to routes[0]
  // when the deep-linked id matches nothing), so a bogus #route=… isn't stored
  // and later serialised back into the hash by setHash.
  let selectedRouteId = $state<string>(initialRoute?.id ?? routes[0]?.id ?? '')
  let currentStopIndex = $state<number>(initialStopIndex >= 0 ? initialStopIndex : 0)

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentRoute = $derived(
    routes.find((r) => r.id === selectedRouteId) ?? routes[0]
  )

  const currentStop = $derived(currentRoute?.stops[currentStopIndex])

  // Track visited stops within the session
  // SvelteSet.add() mutates in place — no read-then-reassign, no infinite loop
  const visited = new SvelteSet<string>()
  $effect(() => {
    if (view === 'stop' && currentStop?.id) visited.add(currentStop.id)
  })

  // ── Hash management ───────────────────────────────────────────────────────
  function setHash(v: View, stopId?: string) {
    const newHash = buildHash(v, stopId, selectedRouteId)
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
    const parsed = parseHash(window.location.hash)
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
  const geoTimestamp = $derived($geolocation.position?.timestamp)
</script>

<div id="fw-app">
  <!-- Night-mode map recolour (design handoff: "Night Map Filter"): maps
       luminance into the red channel, crushes green/blue to near zero.
       Rendered once app-wide; referenced by the night theme's
       --map-canvas-filter: url(#nm-red) — same-document url(#) required. -->
  <svg width="0" height="0" aria-hidden="true">
    <filter id="nm-red" color-interpolation-filters="sRGB">
      <feColorMatrix
        type="matrix"
        values="
        0.52 0.68 0.24 0 0
        0.10 0.13 0.05 0 0
        0.03 0.04 0.02 0 0
        0    0    0    1 0"
      />
    </filter>
  </svg>

  {#if view === 'library' || view === 'route'}
    <TourLibrary
      {routes}
      {view}
      {selectedRouteId}
      currentRoute={currentRoute}
      currentStopId={currentStop?.id ?? null}
      visitedStopIds={visited}
      onSelect={selectRoute}
      onGoToStop={goStopById}
      onBack={goLibrary}
    />

  {:else if view === 'stop' && currentStop && currentRoute}
    <!-- Keyed on the ROUTE only (not the stop): Prev/Next must reuse the
         instance (rail MapPanel stays live, body hydration $effect re-runs),
         but a cross-route hash navigation (back/forward, edited URL) must
         remount — the rail MapPanel's map lifecycle is onMount-scoped to one
         route's basemap, same as the Landing overview (see TourLibrary). -->
    {#key currentRoute.id}
      <TourStopView
        stop={currentStop}
        stopIndex={currentStopIndex}
        route={currentRoute}
        visitedStopIds={visited}
        distanceMetres={currentDist}
        accuracy={geoAccuracy}
        fixTimestamp={geoTimestamp}
        onPrev={() => goStop(currentStopIndex - 1)}
        onNext={() => goStop(currentStopIndex + 1)}
        onBack={goRoute}
        onGoToStop={goStopById}
      />
    {/key}

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
