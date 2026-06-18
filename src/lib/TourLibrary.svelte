<!--
  Tour Library — home screen listing all available tours.
  Shows the fieldWorks wordmark, a segmented filter (Nearby / All / Saved),
  and tour cards with distance, meta chips, and offline status.
-->
<script lang="ts">
  import type { TourRoute } from './types'
  import { geolocation, haversineDistance } from './geo/store'
  import HengeLogo from './HengeLogo.svelte'
  import ThemeToggle from './ThemeToggle.svelte'

  interface Props {
    routes: TourRoute[]
    onSelect: (routeId: string) => void
  }
  const { routes, onSelect }: Props = $props()

  type Filter = 'nearby' | 'all' | 'saved'
  let filter = $state<Filter>('nearby')

  /**
   * Distance (metres) from user to the first stop of a route.
   * Returns Infinity when GPS is unavailable.
   */
  function routeDistance(route: TourRoute): number {
    const geo = $geolocation
    if (!geo.position) return Infinity
    const first = route.stops[0]
    if (!first?.lat || !first?.lng) return Infinity
    return haversineDistance(geo.position.lat, geo.position.lng, first.lat, first.lng)
  }

  const sorted = $derived(
    [...routes].sort((a, b) => routeDistance(a) - routeDistance(b))
  )

  const displayed = $derived.by<TourRoute[]>(() => {
    if (filter === 'nearby') return sorted
    if (filter === 'all')    return [...routes]
    return [] // "Saved" is a future feature
  })

  function fmtDistance(m: number): string {
    if (!isFinite(m)) return ''
    if (m < 1000) return `${Math.round(m)}m`
    return `${(m / 1000).toFixed(1)} km`
  }
</script>

<div class="screen">
  <!-- Status bar -->
  <div class="status-bar">
    <span class="status-right">
      {#if $geolocation.position}
        ⌖ GPS · ▢ offline
      {:else if $geolocation.loading}
        ⌛ locating…
      {:else}
        ▢ offline
      {/if}
    </span>
  </div>

  <!-- App header -->
  <div class="header">
    <div class="wordmark">
      <div class="logo-badge">
        <HengeLogo size={22} />
      </div>
      <span class="wordmark-text">field<span class="accent">Works</span></span>
    </div>

    <div class="header-right">
      <div>
        <h1 class="tours-title">Tours</h1>
        <p class="tours-subtitle">Prehistoric South Downs</p>
      </div>
      <ThemeToggle />
    </div>
  </div>

  <!-- Segmented filter -->
  <div class="filter-row" role="tablist" aria-label="Filter tours">
    {#each (['nearby', 'all', 'saved'] as Filter[]) as f}
      <button
        role="tab"
        aria-selected={filter === f}
        class="filter-btn"
        class:active={filter === f}
        onclick={() => (filter = f)}
      >
        {f.charAt(0).toUpperCase() + f.slice(1)}
      </button>
    {/each}
  </div>

  <!-- Tour cards -->
  <div class="cards" role="tabpanel">
    {#if displayed.length === 0}
      <p class="empty">
        {filter === 'saved' ? 'No saved tours yet.' : 'No tours found.'}
      </p>
    {/if}

    {#each displayed as route, i (route.id)}
      {@const dist = routeDistance(route)}
      {@const isFirst = i === 0 && filter === 'nearby'}
      <button
        class="card"
        class:card--featured={isFirst}
        onclick={() => onSelect(route.id)}
        aria-label="Open tour: {route.name}"
      >
        <!-- Thumbnail: procedural contour art -->
        <div class="card-thumb" class:card-thumb--full={isFirst}>
          <svg class="contour-art" viewBox="0 0 330 96" preserveAspectRatio="none" aria-hidden="true">
            <rect width="330" height="96" fill="none"/>
            <g fill="none" stroke="var(--plate-stroke)" stroke-width="1" opacity="0.45">
              <path d="M0,64 Q80,44 165,56 T330,50"/>
              <path d="M0,76 Q80,56 165,68 T330,62"/>
              <path d="M0,88 Q80,70 165,80 T330,74"/>
            </g>
          </svg>
          {#if isFinite(dist)}
            <span class="dist-badge pill" style="background:var(--olive);color:var(--bg);">
              {fmtDistance(dist)} away
            </span>
          {/if}
        </div>

        <!-- Card body -->
        <div class="card-body">
          <h2 class="card-title">{route.name}</h2>
          <p class="card-desc">{route.description}</p>
          <div class="card-meta">
            <span class="chip">{route.stops.length} stops</span>
            {#if route.total_distance}
              <span class="chip">{route.total_distance}</span>
            {/if}
            {#if route.duration}
              <span class="chip">{route.duration}</span>
            {/if}
            <span class="offline-badge" aria-label="Available offline">▼ offline</span>
          </div>
        </div>
      </button>
    {/each}
  </div>
</div>

<style>
  .screen {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
    background: var(--bg);
    max-width: 430px;
    margin: 0 auto;
  }

  /* Status bar */
  .status-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 26px 6px;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    color: var(--status-text);
    font-weight: 500;
    flex: none;
  }
  .status-right { letter-spacing: 0.05em; }

  /* Header */
  .header {
    padding: 14px 22px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: none;
  }

  .wordmark {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .logo-badge {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background: var(--surface-2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text);
    flex: none;
  }

  .wordmark-text {
    font-weight: 800;
    font-size: 0.875rem;
    color: var(--text);
    letter-spacing: -0.01em;
  }
  .accent { color: var(--accent); }

  .header-right {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .tours-title {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 2.125rem;
    line-height: 1;
    margin: 0;
    color: var(--text);
  }

  .tours-subtitle {
    margin: 7px 0 0;
    font-size: 0.875rem;
    color: var(--muted);
  }

  /* Segmented filter */
  .filter-row {
    display: flex;
    gap: 6px;
    padding: 0 22px 14px;
    flex: none;
  }

  .filter-btn {
    flex: none;
    padding: 8px 16px;
    border-radius: 20px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--muted);
    font-family: var(--font-sans);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .filter-btn.active {
    background: var(--text);
    border-color: var(--text);
    color: var(--bg);
    font-weight: 600;
  }

  /* Cards */
  .cards {
    flex: 1;
    overflow-y: auto;
    padding: 0 18px 24px;
    display: flex;
    flex-direction: column;
    gap: 13px;
  }

  .empty {
    color: var(--muted);
    text-align: center;
    padding: 2rem 0;
    font-size: 0.9375rem;
  }

  .card {
    border: 1px solid var(--border);
    border-radius: 18px;
    overflow: hidden;
    background: var(--surface);
    text-align: left;
    cursor: pointer;
    padding: 0;
    width: 100%;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .card:hover {
    border-color: var(--accent);
  }

  .card--featured {
    border: 1.5px solid var(--accent);
    box-shadow: 0 8px 22px -14px color-mix(in srgb, var(--accent) 50%, transparent);
  }

  /* Thumbnail */
  .card-thumb {
    position: relative;
    height: 72px;
    background: var(--plate-grad);
    overflow: hidden;
  }

  .card-thumb--full {
    height: 96px;
  }

  .contour-art {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .dist-badge {
    position: absolute;
    top: 10px;
    right: 10px;
    font-size: 0.625rem;
    letter-spacing: 0.1em;
  }

  /* Card body */
  .card-body {
    padding: 13px 16px 15px;
  }

  .card-title {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 1.3125rem;
    margin: 0;
    color: var(--text);
  }

  .card-desc {
    margin: 5px 0 0;
    font-size: 0.84375rem;
    line-height: 1.45;
    color: var(--muted-2);
  }

  .card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 11px;
    align-items: center;
  }

  .offline-badge {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    color: var(--olive);
  }

  :global(.chip) {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    color: var(--chip-text);
    background: var(--surface-2);
    border: 1px solid var(--border);
    padding: 5px 9px;
    border-radius: 7px;
  }
</style>
