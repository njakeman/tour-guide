<!--
  Landing — the responsive tour library (design handoff: tablet master–detail).
  ONE component tree, a single 720px viewport breakpoint, nothing added or
  removed between sizes.

  - Phone (narrow OR short): paginated. The card list (rail) is the library
    page; tapping a card opens the tour overview (the "route" view) as a
    separate page.
  - Tablet (≥720px wide AND ≥560px tall): master–detail. A persistent left
    rail holds the "Tours" title and the card list; the selected tour's
    overview (RouteMap) fills the right. There is no standalone Route page —
    it is folded into the overview.
  - Landscape phone (≥720px wide AND <560px tall, handoff "Landscape
    Concepts" 3a/3b): library = identity column + card gallery; route =
    RouteMap's own two-pane layout with this shell's chrome stripped. The
    root's data-view attribute is the CSS hook for both.

  `view` ('library' | 'route') drives which pane shows on phone via
  data-phone-view; at tablet size both panes are always visible (tab state is
  ignored).
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import type { TourRoute } from './types'
  import { geolocation, haversineDistance } from './geo/store'
  import { online, isBasemapCached } from './offline/store'
  import HengeLogo from './HengeLogo.svelte'
  import ThemeToggle from './ThemeToggle.svelte'
  import RouteMap from './RouteMap.svelte'

  interface Props {
    routes: TourRoute[]
    onSelect: (routeId: string) => void
    /** Which pane is primary on phone; ignored ≥ 720px (both show). */
    view?: 'library' | 'route'
    /** Currently selected tour — drives the overview pane and the selected card. */
    selectedRouteId?: string
    currentRoute?: TourRoute
    currentStopId?: string | null
    visitedStopIds?: Set<string>
    onGoToStop?: (stopId: string) => void
    /** Phone: return from the overview to the library list. */
    onBack?: () => void
  }
  const {
    routes,
    onSelect,
    view = 'library',
    selectedRouteId = '',
    currentRoute,
    currentStopId = null,
    visitedStopIds = new Set<string>(),
    onGoToStop = () => {},
    onBack = () => {},
  }: Props = $props()

  // Per-route offline readiness: true once the tour's basemap is in the
  // SW cache (tour text is always offline — it ships in the app bundle).
  let offlineReady = $state<Record<string, boolean>>({})
  onMount(() => {
    for (const route of routes) {
      if (route.map?.basemap) {
        void isBasemapCached(route.map.basemap).then((cached) => {
          offlineReady[route.id] = cached
        })
      }
    }
  })

  // Position used for sorting and the distance badges. It follows the live GPS
  // fix only once the user has moved past a threshold, so the visible card
  // order doesn't churn on every sub-second watch tick (cards reordering under
  // a tapping finger). untrack() keeps this effect from depending on the very
  // state it writes — the read+write-same-state trap (see CLAUDE.md).
  const SORT_MOVE_THRESHOLD_M = 250
  let sortPos = $state<{ lat: number; lng: number } | null>(null)
  $effect(() => {
    const pos = $geolocation.position
    if (!pos) return
    untrack(() => {
      if (
        sortPos === null ||
        haversineDistance(sortPos.lat, sortPos.lng, pos.lat, pos.lng) > SORT_MOVE_THRESHOLD_M
      ) {
        sortPos = { lat: pos.lat, lng: pos.lng }
      }
    })
  })

  /**
   * Distance (metres) from `from` to the first stop of a route.
   * Returns Infinity when there is no fix or the stop has no coordinates
   * (explicit null check: longitude 0 — the prime meridian through Sussex —
   * is a valid coordinate, so a falsy check would wrongly drop it).
   */
  function routeDistance(route: TourRoute, from: { lat: number; lng: number } | null): number {
    if (!from) return Infinity
    const first = route.stops[0]
    if (first?.lat == null || first?.lng == null) return Infinity
    return haversineDistance(from.lat, from.lng, first.lat, first.lng)
  }

  const sorted = $derived(
    [...routes].sort((a, b) => {
      const da = routeDistance(a, sortPos)
      const db = routeDistance(b, sortPos)
      // Equal (notably both Infinity when there's no fix) → keep input order.
      // Array.sort is stable, so returning 0 avoids the NaN a subtraction of
      // two Infinities would produce.
      if (da === db) return 0
      return da < db ? -1 : 1
    })
  )

  // Always the distance-sorted list (nearest first; input order with no fix)
  const displayed = $derived(sorted)

  const nearbyCount = $derived(
    routes.filter((r) => isFinite(routeDistance(r, sortPos))).length
  )

  function fmtDistance(m: number): string {
    if (!isFinite(m)) return ''
    if (m < 1000) return `${Math.round(m)}m`
    return `${(m / 1000).toFixed(1)} km`
  }
</script>

<div class="screen landing" data-view={view}>
  <!-- Status bar -->
  <div class="status-bar">
    <span class="status-right">
      {#if $geolocation.position}
        ⌖ GPS{#if !$online} · ▢ offline{/if}
      {:else if $geolocation.loading}
        ⌛ locating…{#if !$online} · ▢ offline{/if}
      {:else if !$online}
        ▢ offline
      {:else}
        – no GPS
      {/if}
    </span>
  </div>

  <!-- Shared app header (constant across both panes) -->
  <div class="app-header">
    <!-- Wordmark doubles as the home button — returns to the tour list -->
    <button class="wordmark" type="button" aria-label="fieldWorks — back to tour list" onclick={onBack}>
      <div class="logo-badge">
        <HengeLogo size={22} />
      </div>
      <span class="wordmark-text">field<span class="accent">Works</span></span>
    </button>
    <span class="fieldguide-eyebrow">Field guide</span>
    <div class="header-spacer"></div>
    <ThemeToggle />
  </div>

  <!-- Master–detail body -->
  <div class="tl-body" data-phone-view={view}>

    <!-- LEFT RAIL — library list (master) -->
    <div class="tl-rail">
      <div class="rail-head">
        <h1 class="tours-title">Tours</h1>
        <p class="tours-subtitle">
          Prehistoric South Downs{#if nearbyCount > 0} · {nearbyCount} nearby{/if}
        </p>
      </div>

      <div class="tour-list">
        {#if displayed.length === 0}
          <p class="empty">No tours found.</p>
        {/if}

        {#each displayed as route (route.id)}
          {@const dist = routeDistance(route, sortPos)}
          {@const selected = route.id === selectedRouteId}
          <button
            class="tour-card"
            data-tour={route.id}
            data-state={selected ? 'selected' : 'idle'}
            aria-current={selected ? 'true' : undefined}
            onclick={() => onSelect(route.id)}
            aria-label="Open tour: {route.name}"
          >
            {#if selected}
              <!-- Selected: full-width with a gradient header -->
              <div class="card-header">
                <svg class="contour-art" viewBox="0 0 330 78" preserveAspectRatio="none" aria-hidden="true">
                  <g fill="none" stroke="var(--plate-stroke)" stroke-width="1" opacity="0.45">
                    <path d="M0,52 Q80,34 165,46 T330,40"/>
                    <path d="M0,64 Q80,46 165,56 T330,50"/>
                  </g>
                </svg>
                {#if isFinite(dist)}
                  <span class="dist-badge">{fmtDistance(dist)} away</span>
                {/if}
              </div>
              <div class="card-body">
                <h2 class="card-title">{route.name}</h2>
                <p class="card-desc">{route.description}</p>
                <div class="card-meta">
                  <span class="chip">{route.stops.length} stops</span>
                  {#if route.total_distance}<span class="chip">{route.total_distance}</span>{/if}
                  {#if offlineReady[route.id]}
                    <span class="offline-badge" aria-label="Map saved offline">▼ offline</span>
                  {/if}
                </div>
              </div>
            {:else}
              <!-- Idle: compact horizontal -->
              <div class="card-thumb">
                <svg class="contour-art" viewBox="0 0 104 104" preserveAspectRatio="none" aria-hidden="true">
                  <g fill="none" stroke="var(--plate-stroke)" stroke-width="1" opacity="0.42">
                    <path d="M0,68 Q28,52 52,60 T104,56"/>
                    <path d="M0,80 Q28,64 52,72 T104,68"/>
                  </g>
                </svg>
              </div>
              <div class="card-body card-body--compact">
                <!-- Landscape-only distance eyebrow (display:none elsewhere) -->
                {#if isFinite(dist)}<span class="card-dist">{fmtDistance(dist)} away</span>{/if}
                <h2 class="card-title card-title--compact">{route.name}</h2>
                <p class="card-desc card-desc--compact">{route.description}</p>
                <div class="card-meta">
                  <span class="chip">{route.stops.length} stops</span>
                  {#if route.total_distance}<span class="chip">{route.total_distance}</span>{/if}
                </div>
              </div>
            {/if}
          </button>
        {/each}
      </div>
    </div>

    <!-- RIGHT — selected tour overview (detail). Keyed on the route id:
         RouteMap's offline-cache state and MapPanel's map lifecycle are both
         onMount-scoped, so switching tours must remount the pane — otherwise
         the old tour's MapLibre instance / cache badges linger (blank map
         pane, stale "offline ready" chip). -->
    <div class="tl-overview">
      {#if currentRoute}
        {#key currentRoute.id}
          <RouteMap
            route={currentRoute}
            {currentStopId}
            {visitedStopIds}
            {onGoToStop}
            {onBack}
          />
        {/key}
      {/if}
    </div>
  </div>
</div>

<style>
  .screen {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    background: var(--bg);
    margin: 0 auto;
    overflow: hidden;
    width: 100%;
  }

  /* Status bar */
  .status-bar {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    padding: 14px 26px 6px;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    color: var(--status-text);
    font-weight: 500;
    flex: none;
  }
  .status-right { letter-spacing: 0.05em; }

  /* Shared app header */
  .app-header {
    padding: 8px 22px 14px;
    display: flex;
    align-items: center;
    gap: 14px;
    flex: none;
    border-bottom: 1px solid var(--border);
  }

  /* Button reset — the wordmark is the home button but must look unchanged */
  .wordmark {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    cursor: pointer;
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
    font-size: 0.9375rem;
    color: var(--text);
    letter-spacing: -0.01em;
  }
  .accent { color: var(--accent); }

  .fieldguide-eyebrow {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--eyebrow);
  }

  .header-spacer { flex: 1; }

  /* ── Master–detail body ─────────────────────────────────────────────────── */
  .tl-body {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 0;
  }

  .tl-rail {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg);
  }

  .rail-head {
    padding: 18px 22px 12px;
    flex: none;
  }

  .tours-title {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 2rem;
    line-height: 1;
    margin: 0;
    color: var(--text);
  }

  .tours-subtitle {
    margin: 6px 0 0;
    font-size: 0.84375rem;
    color: var(--muted);
  }

  /* Segmented filter */
  /* Card list */
  .tour-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 18px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .empty {
    color: var(--muted);
    text-align: center;
    padding: 2rem 0;
    font-size: 0.9375rem;
  }

  /* Shared card frame */
  .tour-card {
    /* flex:none is load-bearing: the card is a flex child of the scrollable
       .tour-list column and overflow:hidden zeroes its automatic minimum
       size — without this, cards squish to fit instead of scrolling */
    flex: none;
    border-radius: 16px;
    overflow: hidden;
    background: var(--surface);
    text-align: left;
    cursor: pointer;
    padding: 0;
    width: 100%;
    border: 1px solid var(--border);
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .tour-card:hover { border-color: var(--accent); }

  /* Idle: compact horizontal */
  .tour-card[data-state='idle'] {
    display: flex;
  }

  .card-thumb {
    position: relative;
    width: 104px;
    flex: none;
    background: var(--plate-grad);
    overflow: hidden;
  }

  .card-body--compact {
    padding: 11px 14px;
    flex: 1;
  }

  .card-title--compact { font-size: 1.125rem; }
  .card-desc--compact { font-size: 0.78125rem; }

  /* Distance eyebrow on idle cards — landscape-phone only (see below) */
  .card-dist { display: none; }

  /* Selected: full-width with gradient header */
  .tour-card[data-state='selected'] {
    display: block;
    border: 1.5px solid var(--accent);
    box-shadow: 0 8px 22px -14px color-mix(in srgb, var(--accent) 50%, transparent);
  }

  .card-header {
    position: relative;
    height: 78px;
    background: var(--plate-grad);
    overflow: hidden;
  }

  .contour-art {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .dist-badge {
    position: absolute;
    top: 9px;
    right: 10px;
    font-family: var(--font-mono);
    font-size: 0.625rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--bg);
    background: var(--olive);
    padding: 4px 9px;
    border-radius: 20px;
  }

  .card-body {
    padding: 12px 15px 14px;
  }

  .card-title {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 1.25rem;
    margin: 0;
    color: var(--text);
  }

  .card-desc {
    margin: 5px 0 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--muted-2);
  }

  .card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 10px;
    align-items: center;
  }

  .offline-badge {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    color: var(--olive);
  }

  /* ── Overview pane (detail) ─────────────────────────────────────────────── */
  .tl-overview {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
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

  /* ── Responsive breakpoint (wide AND tall) ───────────────────────────────
     Must come after the base rules above: these override display/width at
     equal specificity, so source order decides the winner.
     Master–detail requires ≥720×560 (a landscape phone is wide but short and
     keeps the phone layout); the phone condition is the exact complement. */

  /* Phone (narrow OR short): paginated — one pane at a time, keyed to `view` */
  @media (max-width: 719.98px), (max-height: 559.98px) {
    .screen { max-width: 430px; }
    .tl-body[data-phone-view='library'] .tl-overview { display: none; }
    .tl-body[data-phone-view='route'] .tl-rail { display: none; }
  }

  /* Tablet (wide AND tall): master–detail — rail + overview side by side */
  @media (min-width: 720px) and (min-height: 560px) {
    .tl-rail {
      width: 472px;
      flex: none;
      border-right: 1px solid var(--border-2);
      background: var(--surface-3);
    }
  }

  /* ── Landscape phone shell (design handoff "Landscape Concepts", 3a/3b) ──
     Wide but short (a phone on its side): the same DOM re-laid by CSS.
     This band is a subset of the phone block above, so the phone pane-swap
     rules still decide which pane shows; everything here is scoped by the
     root [data-view] hook. MUST stay the LAST block in this style. */
  @media (min-width: 720px) and (max-height: 559.98px) {
    /* 3a — Tours home: 258px identity column + full-height card gallery */
    .screen[data-view='library'] {
      max-width: none;
      display: grid;
      grid-template-columns: 258px 1fr;
      grid-template-rows: auto auto auto 1fr auto;
      grid-template-areas:
        'status list'
        'brand  list'
        'head   list'
        '.      list'
        'toggle list';
    }
    /* Left-column backdrop (grid items paint over the pseudo-element) */
    .screen[data-view='library']::before {
      content: '';
      grid-row: 1 / -1;
      grid-column: 1 / 2;
      background: var(--surface-3);
      border-right: 1px solid var(--border-2);
    }
    .screen[data-view='library'] .app-header,
    .screen[data-view='library'] .tl-body,
    .screen[data-view='library'] .tl-rail {
      display: contents;
    }
    /* display:contents promotes every child — hide the ones with no slot */
    .screen[data-view='library'] .fieldguide-eyebrow,
    .screen[data-view='library'] .header-spacer {
      display: none;
    }
    .screen[data-view='library'] .status-bar {
      grid-area: status;
      justify-content: flex-start;
      padding: 16px 20px 0;
    }
    .screen[data-view='library'] .wordmark {
      grid-area: brand;
      margin: 18px 20px 0;
      justify-self: start;
    }
    .screen[data-view='library'] .rail-head {
      grid-area: head;
      padding: 20px 20px 0;
    }
    .screen[data-view='library'] .tours-title { font-size: 2.5rem; }
    .screen[data-view='library'] .app-header :global(button.toggle) {
      grid-area: toggle;
      justify-self: end;
      margin: 0 20px 16px 0;
    }
    /* One finger-scrollable column of equal landscape row-cards */
    .screen[data-view='library'] .tour-list {
      grid-area: list;
      padding: 14px 16px;
      gap: 11px;
    }
    /* Flatten the selected variant (gradient header) to the row look —
       every card is a thumbnail-left row in this layout */
    .screen[data-view='library'] .tour-card[data-state='selected'] {
      display: flex;
    }
    .screen[data-view='library'] .tour-card[data-state='selected'] .card-header {
      height: auto;
      flex: none;
    }
    /* Nearest card (first — the list is always distance-sorted) is the
       highlighted row, regardless of which card is selected */
    .screen[data-view='library'] .tour-card:first-child {
      border: 1.5px solid var(--accent);
      box-shadow: 0 8px 22px -14px color-mix(in srgb, var(--accent) 50%, transparent);
      min-height: 160px;
    }
    .screen[data-view='library'] .tour-card:first-child .card-thumb,
    .screen[data-view='library'] .tour-card:first-child .card-header {
      width: 148px;
    }
    .screen[data-view='library'] .tour-card:first-child .card-title {
      font-size: 1.375rem;
    }
    .screen[data-view='library'] .tour-card:first-child .card-body {
      display: flex;
      flex-direction: column;
      padding: 13px 16px;
    }
    /* Bottom-anchor the nearest card's chips, like the design's action row */
    .screen[data-view='library'] .tour-card:first-child .card-meta {
      margin-top: auto;
      padding-top: 11px;
    }
    /* Other rows: 128px thumbnail, centred content, chevron affordance */
    .screen[data-view='library'] .tour-card:not(:first-child) {
      position: relative;
    }
    .screen[data-view='library'] .tour-card:not(:first-child)::after {
      content: '›';
      position: absolute;
      top: 10px;
      right: 14px;
      font-size: 1rem;
      color: var(--muted);
    }
    .screen[data-view='library'] .tour-card:not(:first-child) .card-thumb,
    .screen[data-view='library'] .tour-card:not(:first-child) .card-header {
      width: 128px;
    }
    .screen[data-view='library'] .tour-card:not(:first-child) .card-body {
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    /* Distance eyebrow (hidden at every other size) */
    .screen[data-view='library'] .card-dist {
      display: block;
      font-family: var(--font-mono);
      font-size: 0.5625rem;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--eyebrow);
      margin-bottom: 3px;
    }

    /* 3b — Route overview: strip the shell chrome; RouteMap owns the layout */
    .screen[data-view='route'] {
      max-width: none;
      position: relative;
    }
    .screen[data-view='route'] .status-bar,
    .screen[data-view='route'] .wordmark,
    .screen[data-view='route'] .fieldguide-eyebrow,
    .screen[data-view='route'] .header-spacer {
      display: none;
    }
    .screen[data-view='route'] .app-header { display: contents; }
    .screen[data-view='route'] .app-header :global(button.toggle) {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 5;
    }
  }
</style>
