<script lang="ts">
  import { onMount, onDestroy } from "svelte"
  import { derived } from "svelte/store"
  import TourStop from "./lib/TourStop.svelte"
  import TourNav from "./lib/TourNav.svelte"
  import InterpretationToggle from "./lib/InterpretationToggle.svelte"
  import { geolocation, createProximityStore } from "./lib/geo/store"
  import { routes, allStops } from "virtual:tour-content"
  import type { TourStopData } from "./lib/TourStop.svelte"

  // Current route (default to first)
  let currentRouteIndex = 0
  $: currentRoute = routes[currentRouteIndex]
  $: stops = currentRoute ? currentRoute.stops : []

  // URL-based stop navigation with hash fragments
  function getStopIdFromHash(): string | null {
    const hash = window.location.hash
    if (hash.startsWith('#stop=')) {
      return hash.slice(6)
    }
    return null
  }

  function getInitialIndex(): number {
    const stopId = getStopIdFromHash()
    if (stopId) {
      const found = stops.findIndex((s: TourStopData) => s.id === stopId)
      return found >= 0 ? found : 0
    }
    return 0
  }

  let currentIndex = getInitialIndex()

  function updateHashForStop(index: number) {
    const stop = stops[index]
    if (stop) {
      window.location.hash = `stop=${stop.id}`
    }
  }

  function goToStop(index: number) {
    if (index >= 0 && index < stops.length) {
      currentIndex = index
      updateHashForStop(index)
    }
  }

  let showInterpretation = true

  function prev() {
    goToStop(currentIndex - 1)
  }

  function next() {
    goToStop(currentIndex + 1)
  }

  function toggleInterpretation() {
    showInterpretation = !showInterpretation
  }

  function handleHashChange() {
    const stopId = getStopIdFromHash()
    if (stopId) {
      const found = stops.findIndex((s: TourStopData) => s.id === stopId)
      if (found >= 0) {
        currentIndex = found
      }
    }
  }

  onMount(() => {
    window.addEventListener('hashchange', handleHashChange)
    if (!window.location.hash.startsWith('#stop=')) {
      updateHashForStop(currentIndex)
    }
  })

  onDestroy(() => {
    window.removeEventListener('hashchange', handleHashChange)
  })

  $: currentStop = stops[currentIndex]

  // Geolocation & proximity
  $: proximity = createProximityStore(
    derived(
      () => stops,
      ($stops) =>
        $stops.map((s) => ({
          id: s.id,
          lat: s.lat ?? null,
          lng: s.lng ?? null,
        }))
    )
  )

  $: nearestStopId = $proximity.nearestStopId
  $: distances = $proximity.distances
  $: isNearby = (stopId: string, radius: number = 30) => {
    if (!distances[stopId]) return false
    return distances[stopId] <= radius
  }

  // Manual navigation fallback: show nearest stop button
  $: showNearestButton = nearestStopId !== null && nearestStopId !== currentStop?.id
</script>

<main>
  <header class="route-header">
    <h1>{currentRoute.name} <span class="route-icon">{currentRoute.icon}</span></h1>
    <p class="route-desc">{currentRoute.description}</p>
  </header>

  <section class="geo-status">
    {#if $geolocation.loading}
      <p class="geo-loading">Acquiring GPS signal...</p>
    {:else if $geolocation.error}
      <p class="geo-error">GPS unavailable: {$geolocation.error.message}</p>
      <p class="geo-manual">Using manual navigation. Walk to the next stop and tap the buttons below.</p>
    {:else if $geolocation.position}
      <p class="geo-active">
        GPS active (accuracy: {Math.round($geolocation.position.accuracy)}m)
      </p>
      {#if nearestStopId && distances[nearestStopId]}
        <p class="geo-nearest">
          Nearest stop: {stops.find((s) => s.id === nearestStopId)?.title} —
          {distances[nearestStopId]}m away
        </p>
      {/if}
      {#if currentStop && currentStop.lat && currentStop.lng}
        {#if isNearby(currentStop.id, currentStop.proximity_radius || 30)}
          <p class="geo-here pulse">You are at this stop</p>
        {:else}
          <p class="geo-distance">
            {distances[currentStop.id] ? distances[currentStop.id] + 'm to this stop' : 'Distance unavailable'}
          </p>
        {/if}
      {/if}
    {/if}
  </section>

  {#if showNearestButton}
    <button
      class="nearest-btn"
      on:click={() => {
        const idx = stops.findIndex((s) => s.id === nearestStopId)
        if (idx >= 0) goToStop(idx)
      }}
    >
      Jump to nearest stop ({stops.find((s) => s.id === nearestStopId)?.title})
    </button>
  {/if}

  <InterpretationToggle enabled={showInterpretation} onToggle={toggleInterpretation} />

  <TourStop stop={currentStop} {showInterpretation} />

  <TourNav {currentIndex} total={stops.length} onPrev={prev} onNext={next} />
</main>

<style>
  main {
    padding: 1rem;
    max-width: 70ch;
    margin: 0 auto;
  }

  .route-header {
    margin-bottom: 1.5rem;
    text-align: center;
  }

  .route-header h1 {
    margin: 0 0 0.5rem 0;
    font-size: 1.5rem;
    color: #2d3748;
  }

  .route-icon {
    font-size: 1.25rem;
  }

  .route-desc {
    margin: 0;
    color: #718096;
    font-size: 0.9375rem;
  }

  .geo-status {
    background: #edf2f7;
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
    margin-bottom: 1.5rem;
    font-size: 0.875rem;
  }

  .geo-status p {
    margin: 0;
    line-height: 1.5;
  }

  .geo-loading {
    color: #d69e2e;
  }

  .geo-error {
    color: #e53e3e;
  }

  .geo-manual {
    color: #718096;
    font-size: 0.8125rem;
    margin-top: 0.25rem;
  }

  .geo-active {
    color: #38a169;
  }

  .geo-nearest {
    color: #2b6cb0;
    font-weight: 600;
  }

  .geo-here {
    color: #38a169;
    font-weight: 700;
  }

  .geo-distance {
    color: #718096;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  .pulse {
    animation: pulse 2s infinite;
  }

  .nearest-btn {
    display: block;
    width: 100%;
    margin: 1rem 0 1.5rem 0;
    padding: 0.75rem 1rem;
    background: #4a5568;
    color: white;
    border: none;
    border-radius: 0.5rem;
    font-size: 1rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  .nearest-btn:hover {
    background: #2d3748;
  }
</style>
