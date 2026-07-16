<!--
  Tour overview — the "detail" pane of the responsive Landing (design handoff:
  the tablet master–detail Landing). Renders a selected tour's hero, description,
  meta chips, the route map (MapPanel), stop list, and the Start-tour CTA.

  It is NOT a full screen: the status bar, app header, and theme toggle live in
  the Landing shell (TourLibrary), which mounts this component in its right pane.

  - < 720px (phone): this is the standalone "route" page reached by tapping a
    card; a back chip (top-left of the hero) returns to the library list.
  - ≥ 720px (tablet): this fills the right of the master–detail split; the
    back chip is hidden because the card list rail is always visible.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import type { TourRoute } from './types'
  import { geolocation, haversineDistance } from './geo/store'
  import {
    isTourCached,
    cacheTourOffline,
    tourOfflineBytes,
    fmtBytes,
  } from './offline/store'
  import MapPanel from './MapPanel.svelte'
  import StopList from './StopList.svelte'

  interface Props {
    route: TourRoute
    currentStopId: string | null
    visitedStopIds: Set<string>
    /** Phone: return to the library list. Hidden ≥ 720px. */
    onBack: () => void
    onGoToStop: (stopId: string) => void
  }
  const { route, currentStopId, visitedStopIds, onBack, onGoToStop }: Props = $props()

  // ── Distance to the tour (first stop) for the hero badge ──────────────────
  const distanceMetres = $derived.by<number>(() => {
    const geo = $geolocation
    const first = route.stops[0]
    if (!geo.position || !first?.lat || !first?.lng) return Infinity
    return haversineDistance(geo.position.lat, geo.position.lng, first.lat, first.lng)
  })

  function fmtDistance(m: number): string {
    if (!isFinite(m)) return ''
    if (m < 1000) return `${Math.round(m)}m`
    return `${(m / 1000).toFixed(1)} km`
  }

  // ── Offline tour state (basemap + all manifest media) ────────────────────
  // Sizes come from the build-time OfflineManifest — no runtime HEAD requests.
  // (The cached/saving flags are still onMount-scoped to one route: the
  // component is remounted per route via {#key} in TourLibrary.)
  let tourCached = $state(false)
  let saving = $state(false)
  let saveFailed = $state(false)
  let saveProgress = $state<{ done: number; total: number } | null>(null)

  const offlineBytes = $derived(tourOfflineBytes(route))
  const sizeLabel = $derived(offlineBytes > 0 ? ` · ~${fmtBytes(offlineBytes)}` : '')
  const canSaveOffline = $derived(!!route.offline || !!route.map?.basemap)

  /** Download everything the tour needs offline (media + basemap) into the SW caches. */
  async function saveTourOffline() {
    if (!canSaveOffline || saving || tourCached) return
    saving = true
    saveFailed = false
    try {
      await cacheTourOffline(route, (done, total) => (saveProgress = { done, total }))
      tourCached = true
    } catch {
      saveFailed = true
    } finally {
      saving = false
      saveProgress = null
    }
  }

  onMount(() => {
    if (canSaveOffline) void isTourCached(route).then((cached) => (tourCached = cached))
  })

  // ── Start / resume ────────────────────────────────────────────────────────
  const inProgress = $derived(visitedStopIds.size > 0)
  const resumeIndex = $derived(
    Math.max(0, route.stops.findIndex((s) => s.id === currentStopId))
  )

  function startTour(): void {
    const target = currentStopId ?? route.stops[0]?.id
    if (target) onGoToStop(target)
  }
</script>

<div class="tour-overview" data-tour={route.id}>
  <div class="ov-scroll">

    <!-- Hero: gradient + contour art + scrim, tour name overlaid -->
    <div class="ov-hero">
      <div class="ov-hero-grad" aria-hidden="true"></div>
      <svg class="ov-hero-svg" viewBox="0 0 708 206" preserveAspectRatio="none" aria-hidden="true">
        <g fill="none" stroke="var(--plate-stroke)" stroke-width="1" opacity="0.46">
          <path d="M0,140 Q180,108 360,128 T708,116"/>
          <path d="M0,160 Q180,128 360,148 T708,138"/>
          <path d="M0,180 Q180,150 360,168 T708,160"/>
        </g>
      </svg>
      <div class="ov-hero-scrim" aria-hidden="true"></div>

      <!-- Phone-only: back to the library list (hidden ≥ 720px) -->
      <button class="nav-back ov-back" aria-label="Back to tour list" onclick={onBack}>‹</button>

      <div class="ov-hero-text">
        {#if route.subtitle}
          <div class="ov-eyebrow">{route.subtitle}</div>
        {/if}
        <h1 class="ov-title">{route.name}</h1>
      </div>

      {#if isFinite(distanceMetres)}
        <span class="ov-dist-badge">{fmtDistance(distanceMetres)} away</span>
      {/if}
    </div>

    <div class="ov-content">
      <p class="ov-desc">{route.description}</p>

      <!-- Meta chips -->
      <div class="ov-meta">
        <span class="chip">{route.stops.length} stops</span>
        {#if route.total_distance}<span class="chip">{route.total_distance}</span>{/if}
        {#if route.duration}<span class="chip">{route.duration}</span>{/if}
        {#if tourCached}
          <span class="chip chip--offline">⤓ offline ready</span>
        {/if}
      </div>

      <!-- Route map -->
      <div class="ov-route-label">The route</div>
      <div class="map-wrap">
        <MapPanel {route} {currentStopId} {visitedStopIds} {onGoToStop} />
      </div>

      <!-- Stop list (useful on phone; scrolls with the overview) -->
      <div class="ov-stops">
        <StopList {route} {currentStopId} {visitedStopIds} {onGoToStop} />
      </div>
    </div>
  </div>

  <!-- Footer: save-tour-offline button + Start/Resume CTA -->
  <footer class="ov-footer">
    {#if canSaveOffline}
      <button
        class="ov-save"
        class:ov-save--done={tourCached}
        onclick={saveTourOffline}
        disabled={saving || tourCached}
        aria-label={
          tourCached ? 'Tour saved offline'
          : saving ? 'Saving tour offline'
          : saveFailed ? 'Retry saving tour offline'
          : `Save tour offline${sizeLabel}`
        }
        title={
          tourCached ? 'Tour saved offline'
          : saveFailed ? 'Retry saving tour offline'
          : `Save tour offline${sizeLabel}`
        }
      >
        <span class="ov-save-icon" aria-hidden="true">
          {#if saving}…{:else if tourCached}✓{:else}▼{/if}
        </span>
        <span class="ov-save-label">
          {#if saving && saveProgress}Saving {saveProgress.done}/{saveProgress.total}…
          {:else if saving}Saving…
          {:else if tourCached}Offline
          {:else if saveFailed}Retry save
          {:else}Save tour offline{sizeLabel}{/if}
        </span>
      </button>
    {/if}

    <button class="start-tour" data-tour={route.id} onclick={startTour}>
      {#if inProgress}
        <span class="start-label">Resume</span>
        <span class="start-sub">· stop {resumeIndex + 1} of {route.stops.length} ›</span>
      {:else}
        <span class="start-label">Start tour</span>
        <span class="start-sub">· {route.stops.length} stops{route.duration ? ` · ${route.duration}` : ''} ›</span>
      {/if}
    </button>
  </footer>
</div>

<style>
  .tour-overview {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    background: var(--bg);
  }

  .ov-scroll {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
  }

  /* ── Hero ─────────────────────────────────────────────────────────────── */
  .ov-hero {
    position: relative;
    height: 196px;
    flex: none;
    overflow: hidden;
  }

  .ov-hero-grad {
    position: absolute;
    inset: 0;
    background: var(--plate-grad);
  }

  .ov-hero-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .ov-hero-scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.55));
  }

  .ov-back {
    position: absolute;
    top: 14px;
    left: 14px;
    z-index: 2;
  }

  .ov-hero-text {
    position: absolute;
    left: 28px;
    right: 28px;
    bottom: 18px;
  }

  .ov-eyebrow {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #f6efdd;
    text-shadow: 0 1px 3px rgba(0,0,0,0.5);
  }

  .ov-title {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 2.25rem;   /* 36px phone */
    line-height: 1.02;
    margin: 6px 0 0;
    color: #fbf7ec;
    text-shadow: 0 2px 8px rgba(0,0,0,0.4);
    letter-spacing: -0.014em;
  }

  .ov-dist-badge {
    position: absolute;
    top: 16px;
    right: 16px;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #fbf7ec;
    background: color-mix(in srgb, var(--olive) 92%, transparent);
    padding: 5px 11px;
    border-radius: 20px;
  }

  /* ── Content ──────────────────────────────────────────────────────────── */
  .ov-content {
    padding: 18px 22px 0;
    display: flex;
    flex-direction: column;
  }

  .ov-desc {
    margin: 0;
    font-size: 1.03125rem;
    line-height: 1.6;
    color: var(--text-body);
    max-width: 600px;
  }

  .ov-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
  }

  .chip--offline {
    color: var(--olive);
    border-color: var(--olive);
  }

  .ov-route-label {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 18px 0 10px;
  }

  .map-wrap {
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: var(--map-bg);
    flex: none;
    /* 330 × 236 matches the SVG viewBox */
    aspect-ratio: 330 / 236;
  }

  .ov-stops {
    padding: 18px 0 8px;
  }

  /* ── Footer CTA ───────────────────────────────────────────────────────── */
  .ov-footer {
    flex: none;
    border-top: 1px solid var(--border-2);
    background: var(--surface-3);
    display: flex;
    gap: 12px;
    padding: 16px 20px calc(20px + env(safe-area-inset-bottom));
  }

  /* Labelled pill — the icon-only square proved undiscoverable */
  .ov-save {
    height: 60px;
    padding: 0 16px;
    border-radius: 16px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--olive);
    cursor: pointer;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: opacity 0.15s;
  }

  .ov-save-icon {
    font-size: 1.125rem;
    line-height: 1;
  }

  .ov-save-label {
    font-family: var(--font-sans);
    font-weight: 600;
    font-size: 0.9375rem;
    white-space: nowrap;
  }

  .ov-save:disabled {
    cursor: default;
  }

  .ov-save--done {
    color: var(--olive);
    border-color: var(--olive);
    opacity: 0.85;
  }

  .start-tour {
    flex: 1;
    min-width: 0;
    height: 60px;
    border-radius: 16px;
    background: var(--accent-btn);
    color: var(--accent-btn-text);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: opacity 0.15s;
  }

  .start-tour:hover { opacity: 0.92; }

  .start-label {
    font-family: var(--font-sans);
    font-weight: 700;
    font-size: 1.0625rem;
    /* The labelled save pill narrows the CTA — the sub-line truncates
       (below) but the primary label must never wrap */
    white-space: nowrap;
  }

  .start-sub {
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    opacity: 0.85;
    white-space: nowrap;
    /* The labelled save pill narrows the CTA on small phones — truncate the
       sub-line rather than overflowing the footer */
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Back chip (phone only) — reuses the square nav button look */
  .nav-back {
    width: 44px;
    height: 44px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--surface-2) 82%, transparent);
    border: 1px solid var(--border);
    font-size: 1.375rem;
    color: var(--text);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(3px);
  }

  /* ── Responsive breakpoint (wide AND tall) ───────────────────────────────
     Must come after the base rules above: it overrides height/font-size/
     display at equal specificity, so source order decides the winner.
     Same ≥720×560 condition as the Landing/stop screens — a landscape phone
     keeps the phone overview (incl. the .ov-back chip, its only way back). */
  @media (min-width: 720px) and (min-height: 560px) {
    .ov-hero { height: 206px; }
    .ov-title { font-size: 2.5rem; }   /* 40px */
    .ov-back { display: none; }         /* rail is always visible on tablet */
  }

  /* ── Landscape phone (design handoff "Landscape Concepts", 3b) ──────────
     Wide but short: two panes side by side — header + full-height map on
     the left, itinerary (label, chips, scrolling stop list, CTA) on the
     right. Same DOM re-laid by grid + display:contents; the Landing shell
     (TourLibrary) hides its own chrome in this band and floats the theme
     toggle top-right over this pane. MUST stay the LAST block. */
  @media (min-width: 720px) and (max-height: 559.98px) {
    .tour-overview {
      display: grid;
      grid-template-columns: 436px 1fr;
      grid-template-rows: auto auto 1fr auto;
      grid-template-areas:
        'hero label'
        'map  meta'
        'map  stops'
        'map  footer';
    }
    /* Right-pane backdrop (grid items paint over the pseudo-element) */
    .tour-overview::before {
      content: '';
      grid-column: 2 / 3;
      grid-row: 1 / -1;
      background: var(--surface-3);
      border-left: 1px solid var(--border-2);
    }
    .ov-scroll,
    .ov-content {
      display: contents;
    }
    /* Hero collapses to a header row: back chip + eyebrow/title on-surface */
    .ov-hero {
      grid-area: hero;
      height: auto;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 13px 16px;
      overflow: visible;
    }
    .ov-hero-grad,
    .ov-hero-svg,
    .ov-hero-scrim,
    .ov-dist-badge {
      display: none;
    }
    .ov-back {
      position: static;
      width: 42px;
      height: 42px;
      flex: none;
    }
    .ov-hero-text {
      position: static;
      flex: 1;
      min-width: 0;
    }
    .ov-eyebrow {
      color: var(--eyebrow);
      text-shadow: none;
    }
    .ov-title {
      font-size: 1.375rem;
      color: var(--text);
      text-shadow: none;
      margin: 2px 0 0;
    }
    .ov-desc { display: none; }
    .map-wrap {
      grid-area: map;
      aspect-ratio: auto;
      min-height: 0;
      margin: 0 14px 14px;
    }
    /* "The route" is promoted to the itinerary pane heading */
    .ov-route-label {
      grid-area: label;
      font-family: var(--font-serif);
      font-weight: 600;
      font-size: 1.3125rem;
      letter-spacing: 0;
      text-transform: none;
      color: var(--text);
      /* right padding clears the floating theme toggle */
      padding: 16px 72px 0 16px;
      margin: 0;
    }
    .ov-meta {
      grid-area: meta;
      padding: 0 16px;
      margin-top: 11px;
    }
    .ov-stops {
      grid-area: stops;
      overflow-y: auto;
      overscroll-behavior: contain;
      min-height: 0;
      padding: 10px 16px 0;
    }
    .ov-footer {
      grid-area: footer;
      border-top: 0;
      background: none;
      padding: 11px 16px 16px;
    }
    /* Tight 436px-column footer: back to the compact square (title/aria-label
       still carry the full wording) */
    .ov-save {
      width: 52px;
      height: 52px;
      padding: 0;
    }
    .ov-save-label { display: none; }
    .start-tour { height: 52px; }
  }
</style>
