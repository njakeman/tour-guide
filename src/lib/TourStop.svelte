<!--
  Stop screen — the core fieldWorks experience, responsive per the design
  handoffs ("Tour Responsive Proof" + "Landscape Concepts 1a"): ONE component
  tree, nothing added or removed between sizes; CSS decides among THREE
  layouts:

  - Phone (width < 720px, any height): paginated. The stop detail is primary;
    the map and the stop list live behind the bottom tab bar (Stop /
    Map & route / Stops).
  - Tablet (≥720px wide AND ≥560px tall): master–detail. A persistent left
    rail shows the map + stop list; the detail fills the right; no tab bar;
    the Evidence/Interpretation accordions sit side by side.
  - Landscape phone shell (≥720px wide AND <560px tall): "edge rails" — the
    same DOM re-laid by CSS grid + display:contents into a 76px left nav
    rail, a swappable middle (same phoneView state), and a 150px right
    action rail (see the last @media block).

  The map (MapPanel) exists in the DOM at every width and lazily initialises
  only when its container first has size — see MapPanel.svelte.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import type { TourRoute, TourStop } from './types'
  import { isNearby } from './geo/store'
  import { hydrateModels } from './media/models'
  import MapPanel from './MapPanel.svelte'
  import StopList from './StopList.svelte'
  import ThemeToggle from './ThemeToggle.svelte'
  import Lightbox from './Lightbox.svelte'

  interface Props {
    stop: TourStop
    stopIndex: number
    route: TourRoute
    visitedStopIds: Set<string>
    /** Distance in metres; undefined when no GPS */
    distanceMetres?: number
    /** GPS accuracy in metres; undefined when no GPS */
    accuracy?: number
    /** Epoch ms of the latest GPS fix; undefined when no GPS */
    fixTimestamp?: number
    onPrev: () => void
    onNext: () => void
    onBack: () => void
    onGoToStop: (stopId: string) => void
  }

  const {
    stop,
    stopIndex,
    route,
    visitedStopIds,
    distanceMetres,
    accuracy,
    fixTimestamp,
    onPrev,
    onNext,
    onBack,
    onGoToStop,
  }: Props = $props()

  const totalStops = $derived(route.stops.length)
  const nextStop = $derived(route.stops[stopIndex + 1])

  // ── Phone pane (only meaningful < 720px; the tab bar is hidden above) ────
  type PhoneView = 'stop' | 'map' | 'stops'
  let phoneView = $state<PhoneView>('stop')
  const tabs: { view: PhoneView; icon: string; label: string }[] = [
    { view: 'stop', icon: '▤', label: 'Stop' },
    { view: 'map', icon: '◎', label: 'Map & route' },
    { view: 'stops', icon: '≣', label: 'Stops' },
  ]

  /** Selecting a stop from the rail returns the phone to the detail pane. */
  function goStopFromRail(stopId: string) {
    onGoToStop(stopId)
    phoneView = 'stop'
  }

  // ── Proximity ─────────────────────────────────────────────────────────────
  // A fix older than this is shown as stale rather than as a live distance
  const STALE_FIX_MS = 60_000

  let now = $state(Date.now())
  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 10_000)
    return () => clearInterval(t)
  })

  const radius = $derived(stop.proximity_radius ?? 30)
  const fixStale = $derived(
    fixTimestamp !== undefined && now - fixTimestamp > STALE_FIX_MS
  )
  const nearby = $derived(
    distanceMetres !== undefined &&
    accuracy !== undefined &&
    !fixStale &&
    isNearby(distanceMetres, radius, accuracy)
  )

  function fmtDistance(m: number): string {
    if (m < 1000) return `${m}m`
    return `${(m / 1000).toFixed(1)} km`
  }

  function fmtFixAge(ms: number): string {
    const mins = Math.round(ms / 60_000)
    return mins <= 1 ? '1 min' : `${mins} min`
  }

  // Whether the phone stop-hero becomes a locator map (needs coordinates).
  // A coordinate-less stop keeps its photo / contour-art plate at every width.
  const hasHeroMap = $derived(stop.lat != null && stop.lng != null)

  // Hero image: explicit hero field takes priority
  const heroSrc = $derived(stop.hero?.src ?? stop.media?.find((m) => m.type === 'image')?.src)
  const heroCaption = $derived(stop.hero?.caption ?? stop.media?.find((m) => m.type === 'image')?.caption)

  // Hide the <img> on load error and reveal the contour-SVG fallback.
  // Reset on stop change — the component is not keyed in App.svelte, so one
  // broken hero must not suppress every later stop's hero. (Writes state it
  // does not read, so no effect_update_depth_exceeded risk.)
  let heroFailed = $state(false)
  function onHeroError() { heroFailed = true }
  $effect(() => {
    void stop.id
    heroFailed = false
  })

  // ── Body media: model hydration + image lightbox ─────────────────────────
  let bodyEl = $state<HTMLElement | null>(null)
  let lightbox = $state<{ src: string; alt: string; caption?: string } | null>(null)

  function openHeroLightbox() {
    if (!heroSrc) return
    lightbox = { src: heroSrc, alt: heroCaption ?? stop.title, caption: heroCaption }
  }

  // Runs after each {@html} render (the component is not keyed, so prev/next
  // swaps bodyHtml in place): upgrade .media-model stubs to <model-viewer>
  // and make body images open the lightbox. Reads bodyHtml/bodyEl, writes
  // only the DOM — `lightbox` is set inside event handlers, not the effect.
  $effect(() => {
    void stop.bodyHtml
    const el = bodyEl
    if (!el) return

    void hydrateModels(el)

    for (const img of el.querySelectorAll<HTMLImageElement>('.media-img img')) {
      img.setAttribute('role', 'button')
      img.tabIndex = 0
    }

    const openFromEvent = (event: Event) => {
      const img = (event.target as Element).closest<HTMLImageElement>('.media-img img')
      if (!img) return
      const caption =
        img.closest('figure')?.querySelector('figcaption')?.textContent ?? undefined
      lightbox = { src: img.src, alt: img.alt, caption }
    }
    const onBodyClick = (event: MouseEvent) => openFromEvent(event)
    const onBodyKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      if (!(event.target as Element).closest('.media-img img')) return
      event.preventDefault()
      openFromEvent(event)
    }
    el.addEventListener('click', onBodyClick)
    el.addEventListener('keydown', onBodyKeydown)
    return () => {
      el.removeEventListener('click', onBodyClick)
      el.removeEventListener('keydown', onBodyKeydown)
    }
  })
</script>

<div class="screen">
  <!-- Status bar -->
  <div class="status-bar">
    <span class="status-right">
      {#if stop.elevation}↑ {stop.elevation} · {/if}⌖ GPS
    </span>
  </div>

  <!-- App header -->
  <div class="app-header">
    <button class="nav-sq nav-back" aria-label="Back to route" onclick={onBack}>‹</button>
    <div class="header-center">
      <div class="header-eyebrow">{route.name}</div>
      <div class="header-sub">Stop {stopIndex + 1} of {totalStops} · {stop.title}</div>
    </div>
    <ThemeToggle />
  </div>

  <!-- Progress segments -->
  <div class="progress-bar" role="progressbar" aria-label="Tour progress" aria-valuemin={1} aria-valuenow={stopIndex + 1} aria-valuemax={totalStops}>
    {#each Array(totalStops) as _, i}
      <div class="progress-seg" class:progress-seg--done={i <= stopIndex}></div>
    {/each}
  </div>

  <!-- One DOM for every width: rail (map + list) + detail -->
  <div class="ts-body" data-phone-view={phoneView}>

    <!-- LEFT RAIL — map + stop list. Persistent ≥ 720px; behind the
         Map / Stops tabs below. Present in the DOM at every width. -->
    <aside class="ts-rail" aria-label="Route map and stops">
      <div class="rail-map">
        <!-- center follows the active stop, so Prev/Next glides the rail map
             to each stop; zoom is left alone (route default, user-adjustable) -->
        <MapPanel
          {route}
          currentStopId={stop.id}
          {visitedStopIds}
          onGoToStop={goStopFromRail}
          center={stop.lat != null && stop.lng != null ? [stop.lng, stop.lat] : undefined}
        />
      </div>
      <div class="rail-list">
        <StopList
          {route}
          currentStopId={stop.id}
          {visitedStopIds}
          onGoToStop={goStopFromRail}
          activeDistanceMetres={fixStale ? undefined : distanceMetres}
        />
      </div>
    </aside>

    <!-- RIGHT — active stop detail -->
    <div class="ts-detail stop-detail" data-stop-index={stopIndex}>
      <div class="scroll-body">

        <!-- Hero plate: on phone this becomes a map centred on the current
             stop (useful mid-walk); tablet keeps the photo since the rail
             map is already visible. Both blocks exist in the DOM at every
             width — CSS + MapPanel's lazy ResizeObserver init decide what
             actually renders (see the @media blocks at the end of <style>). -->
        <div class="plate stop-hero" data-has-map={hasHeroMap ? 'true' : undefined}>
          {#if stop.lat != null && stop.lng != null}
            <div class="hero-map">
              <MapPanel
                {route}
                currentStopId={stop.id}
                {visitedStopIds}
                onGoToStop={goStopFromRail}
                center={[stop.lng, stop.lat]}
                zoom={16}
                label={`Map showing the location of ${stop.title}`}
                id="tour-map-hero"
              />
            </div>
          {/if}
          {#if heroSrc && !heroFailed}
            <button
              class="plate-zoom"
              type="button"
              aria-label={`View image: ${heroCaption ?? stop.title}`}
              onclick={openHeroLightbox}
            >
              <img src={heroSrc} alt={heroCaption ?? stop.title} class="plate-img" loading="eager" onerror={onHeroError} />
            </button>
          {:else}
            <!-- Procedural contour art fallback -->
            <svg class="plate-svg" viewBox="0 0 366 212" preserveAspectRatio="none" aria-hidden="true">
              <rect width="366" height="212" fill="none"/>
              <g fill="none" stroke="var(--plate-stroke)" stroke-width="1" opacity="0.5">
                <path d="M0,150 Q90,120 180,138 T366,128"/>
                <path d="M0,166 Q90,138 180,154 T366,146"/>
                <path d="M0,182 Q90,156 180,170 T366,164"/>
                <path d="M0,198 Q90,176 180,188 T366,184"/>
              </g>
            </svg>
          {/if}
          <!-- Gradient overlay -->
          <div class="plate-overlay" aria-hidden="true"></div>
          <!-- Caption row -->
          <div class="plate-footer">
            {#if heroCaption}
              <span class="plate-caption">{heroCaption}</span>
            {/if}
          </div>
        </div>

        <!-- Textual detail. A plain block at portrait/tablet (no visual
             effect); the landscape shell turns .scroll-body into a row and
             scrolls THIS column beside the fixed media plate. -->
        <div class="detail-content">

        <!-- Title block -->
        <div class="title-block">
          {#if stop.era}
            <div class="era-eyebrow">{stop.era}</div>
          {/if}
          <h1 class="stop-title ts-title">{stop.title}</h1>

          {#if stop.grid_ref || stop.elevation || stop.walk_time}
            <div class="meta-chips">
              {#if stop.grid_ref}<span class="chip">{stop.grid_ref}</span>{/if}
              {#if stop.elevation}<span class="chip">{stop.elevation}</span>{/if}
              {#if stop.walk_time}<span class="chip">↥ {stop.walk_time}</span>{/if}
            </div>
          {/if}
        </div>

        <!-- Body text (pre-rendered HTML from build-time markdown) -->
        {#if stop.bodyHtml}
          <div class="body-text" bind:this={bodyEl}>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html stop.bodyHtml}
          </div>
        {/if}

        <!-- Accordions: stacked on phone, side-by-side ≥ 720px -->
        <div class="accordions ts-accordions">
          <details class="accordion stop-accordion" data-section="evidence" open>
            <summary class="accordion-summary">
              <span class="accordion-dot accordion-dot--square" aria-hidden="true"></span>
              <span class="accordion-label">Evidence</span>
              <span class="accordion-toggle" aria-hidden="true"></span>
            </summary>
            <div class="accordion-body">
              <p>{stop.evidence}</p>
            </div>
          </details>

          {#if stop.interpretation}
            <details class="accordion stop-accordion" data-section="interpretation">
              <summary class="accordion-summary">
                <span class="accordion-dot accordion-dot--round" aria-hidden="true"></span>
                <span class="accordion-label">Interpretation</span>
                <span class="accordion-toggle" aria-hidden="true"></span>
              </summary>
              <div class="accordion-body">
                <p>{stop.interpretation}</p>
              </div>
            </details>
          {/if}
        </div>

        <div class="scroll-spacer"></div>
        </div> <!-- /.detail-content -->
      </div>

      <!-- Proximity footer + nav -->
      <footer class="footer">
        <!-- GPS status strip -->
        <div class="proximity-strip proximity">
          {#if distanceMetres !== undefined && fixStale && fixTimestamp !== undefined}
            <span class="proximity-text muted">
              ~{fmtDistance(distanceMetres)} to this stop · last GPS fix {fmtFixAge(now - fixTimestamp)} ago
            </span>
          {:else if distanceMetres !== undefined}
            <span class="ping" aria-hidden="true">
              <span class="ping-dot"></span>
              <span class="ping-ripple"></span>
            </span>
            <span class="proximity-text">
              {#if nearby}
                You're <strong class="dist-highlight">{fmtDistance(distanceMetres)}</strong> from this stop · arriving
              {:else}
                <strong class="dist-highlight">{fmtDistance(distanceMetres)}</strong> to this stop
              {/if}
            </span>
          {:else}
            <span class="proximity-text muted">GPS unavailable — use manual navigation</span>
          {/if}
        </div>

        <!-- Prev / Next nav -->
        <div class="nav-row">
          <button
            class="nav-sq"
            aria-label="Previous stop"
            disabled={stopIndex === 0}
            onclick={onPrev}
          >‹</button>
          <button
            class="nav-next next-stop"
            data-target-index={stopIndex + 1}
            aria-label="Next stop"
            disabled={stopIndex === totalStops - 1}
            onclick={onNext}
          >
            <span class="nav-next-label">
              {stopIndex === totalStops - 1 ? 'Final stop' : 'Next stop'}
            </span>
            {#if nextStop}
              <span class="nav-next-name">· {nextStop.title} ›</span>
            {/if}
          </button>
        </div>
      </footer>
    </div>
  </div>

  <!-- BOTTOM TAB BAR — phone only (hidden ≥ 720px) -->
  <nav class="ts-tabs" aria-label="Stop views">
    {#each tabs as tab (tab.view)}
      <button
        class="ts-tab"
        class:ts-tab--active={phoneView === tab.view}
        data-view={tab.view}
        aria-current={phoneView === tab.view ? 'true' : undefined}
        onclick={() => (phoneView = tab.view)}
      >
        <span class="ts-tab-icon" aria-hidden="true">{tab.icon}</span>
        <span class="ts-tab-label">{tab.label}</span>
      </button>
    {/each}
  </nav>

  <!-- Full-screen image lightbox — outside .scroll-body so touch scrolling
       cannot chain into the page behind it -->
  {#if lightbox}
    <Lightbox
      src={lightbox.src}
      alt={lightbox.alt}
      caption={lightbox.caption}
      onClose={() => (lightbox = null)}
    />
  {/if}
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

  /* App header */
  .app-header {
    padding: 6px 18px 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
  }

  .nav-sq {
    width: 46px;
    height: 46px;
    border-radius: 14px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    font-size: 1.375rem;
    color: var(--text);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    transition: background 0.15s;
  }

  .nav-sq:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .nav-sq:not(:disabled):hover {
    background: var(--surface);
  }

  .header-center {
    flex: 1;
    text-align: center;
    min-width: 0;
  }

  .header-eyebrow {
    font-family: var(--font-mono);
    font-size: 0.65625rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--eyebrow);
  }

  .header-sub {
    font-size: 0.8125rem;
    color: var(--muted);
    margin-top: 2px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Progress bar */
  .progress-bar {
    display: flex;
    gap: 5px;
    padding: 0 18px 14px;
    flex: none;
  }

  .progress-seg {
    flex: 1;
    height: 5px;
    border-radius: 3px;
    background: var(--progress-todo);
    transition: background 0.3s;
  }

  .progress-seg--done {
    background: var(--progress-done);
  }

  /* ── Responsive body: rail + detail ──────────────────────────────────── */
  .ts-body {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 0;
  }

  .ts-rail {
    flex-direction: column;
    min-height: 0;
    background: var(--surface-3);
  }

  .rail-map {
    height: 264px;
    margin: 16px;
    border-radius: 15px;
    overflow: hidden;
    border: 1px solid var(--border);
    flex: none;
  }

  .rail-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 14px 14px;
  }

  .ts-detail {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }

  /* Scrollable body */
  .scroll-body {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    overscroll-behavior: contain;
  }

  /* Hero plate */
  .plate {
    position: relative;
    height: 196px;
    margin: 16px 20px 0;
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: var(--plate-grad);
    flex: none;
  }

  /* Hero zoom affordance: the button fills the plate, the image fills it */
  .plate-zoom {
    position: absolute;
    inset: 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
    display: block;
  }

  .plate-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Phone-only stop-locator map; hidden by default (tablet shows the photo).
     Flipped to display:block in the phone @media block below. */
  .hero-map {
    position: absolute;
    inset: 0;
    display: none;
  }

  .plate-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  /* Decorative layers above the hero image must not swallow clicks on the
     zoom button underneath them */
  .plate-overlay {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: 84px;
    background: linear-gradient(180deg, transparent, rgba(0,0,0,0.55));
    pointer-events: none;
  }

  .plate-footer {
    position: absolute;
    left: 14px; bottom: 12px; right: 14px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 10px;
    pointer-events: none;
  }

  .plate-caption {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #f6efdd;
    text-shadow: 0 1px 3px rgba(0,0,0,0.5);
  }

  /* Title block */
  .title-block {
    padding: 20px 22px 0;
  }

  .era-eyebrow {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--eyebrow);
    margin-bottom: 9px;
  }

  .stop-title {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 2rem;   /* 32px */
    line-height: 1.06;
    margin: 0;
    color: var(--text);
    letter-spacing: -0.01em;
  }

  .meta-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
  }

  /* Body text */
  .body-text {
    padding: 18px 22px 0;
    font-size: 1.0625rem;
    line-height: 1.62;
    color: var(--text-body);
    max-width: 660px;
  }

  .body-text :global(h1),
  .body-text :global(h2),
  .body-text :global(h3) {
    font-family: var(--font-serif);
    font-weight: 600;
    color: var(--text);
    margin: 1.5rem 0 0.75rem;
  }

  .body-text :global(p) {
    margin: 0 0 1rem;
  }

  .body-text :global(ul),
  .body-text :global(ol) {
    margin: 0 0 1rem;
    padding-left: 1.5rem;
  }

  .body-text :global(strong) {
    font-weight: 700;
    color: var(--text);
  }

  .body-text :global(blockquote) {
    border-left: 3px solid var(--accent);
    margin: 1.5rem 0;
    padding: 0.5rem 1rem;
    background: var(--surface);
    font-style: italic;
    color: var(--muted-2);
    border-radius: 0 8px 8px 0;
  }

  .body-text :global(blockquote p) { margin: 0; }

  /* Media figures from the rendered markdown body */
  .body-text :global(.media-img),
  .body-text :global(.media-audio),
  .body-text :global(.media-video),
  .body-text :global(.media-model) {
    margin: 1rem 0;
    border-radius: 14px;
    overflow: hidden;
    background: var(--surface-2);
    border: 1px solid var(--border);
  }

  .body-text :global(.media-img img),
  .body-text :global(.media-video video) {
    width: 100%;
    height: auto;
    display: block;
  }

  /* Body images open the lightbox (affordance set by the hydration effect) */
  .body-text :global(.media-img img) {
    cursor: zoom-in;
  }

  .body-text :global(.media-audio audio) {
    width: 100%;
    padding: 0.5rem;
    display: block;
  }

  .body-text :global(.media-model) {
    padding: 1.5rem;
    text-align: center;
    color: var(--muted);
  }

  .body-text :global(.model-stub) { font-size: 2rem; }
  .body-text :global(.model-label) {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    margin: 0.5rem 0 0;
  }

  /* Hydrated 3D viewer (see media/models.ts) — without an explicit height
     model-viewer renders at its 300×150 canvas default */
  .body-text :global(model-viewer) {
    display: block;
    width: 100%;
    height: 300px;
    background: var(--surface-2);
  }

  .body-text :global(figcaption) {
    padding: 0.5rem 0.75rem 0.75rem;
    font-size: 0.875rem;
    font-style: italic;
    color: var(--muted);
  }

  /* Accordions */
  .accordions {
    margin: 18px 18px 0;
    display: flex;
    flex-direction: column;
    gap: 11px;
  }

  .accordion {
    border: 1px solid var(--border);
    border-radius: 14px;
    overflow: hidden;
    background: var(--surface);
  }

  .accordion-summary {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 13px 16px;
    cursor: pointer;
    list-style: none;
    user-select: none;
    border-bottom: 1px solid transparent;
    transition: border-color 0.15s;
  }

  .accordion[open] .accordion-summary {
    border-bottom-color: var(--border-2);
  }

  .accordion-summary::-webkit-details-marker { display: none; }

  .accordion-dot {
    width: 8px;
    height: 8px;
    flex: none;
    background: var(--olive);
  }

  .accordion-dot--square { border-radius: 2px; }
  .accordion-dot--round  { border-radius: 50%; background: var(--accent); }

  .accordion-label {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted-2);
    flex: 1;
  }

  .accordion-toggle::before {
    content: '+';
    font-size: 1.375rem;
    color: var(--accent);
    line-height: 1;
  }

  .accordion[open] .accordion-toggle::before {
    content: '–';
    font-size: 1.25rem;
  }

  .accordion-body {
    padding: 13px 16px 15px;
  }

  .accordion-body p {
    margin: 0;
    font-size: 0.90625rem;
    line-height: 1.55;
    color: var(--muted-2);
  }

  .scroll-spacer { height: 18px; flex: none; }

  /* Footer */
  .footer {
    flex: none;
    border-top: 1px solid var(--border-2);
    background: var(--footer-bg);
  }

  .proximity-strip {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 22px;
  }

  .ping {
    position: relative;
    width: 10px;
    height: 10px;
    flex: none;
  }

  .ping-dot,
  .ping-ripple {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: var(--olive);
  }

  .ping-ripple {
    animation: tg-pulse 2s ease-out infinite;
  }

  .proximity-text {
    font-size: 0.84375rem;
    color: var(--text);
    font-weight: 500;
  }

  .proximity-text.muted {
    color: var(--muted);
    font-weight: 400;
  }

  .dist-highlight {
    color: var(--olive);
    font-weight: 700;
  }

  .nav-row {
    display: flex;
    gap: 10px;
    padding: 0 16px 18px;
  }

  .nav-next {
    flex: 1;
    height: 58px;
    border-radius: 16px;
    background: var(--accent-btn);
    color: var(--accent-btn-text);
    border: none;
    font-family: var(--font-sans);
    font-weight: 700;
    font-size: 1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: opacity 0.15s;
  }

  .nav-next:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .nav-next-name {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    opacity: 0.85;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Bottom tab bar (phone only) ─────────────────────────────────────── */
  .ts-tabs {
    display: flex;
    flex: none;
    gap: 8px;
    border-top: 1px solid var(--border-2);
    background: var(--bg);
    padding: 9px 14px calc(9px + env(safe-area-inset-bottom));
  }

  .ts-tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 6px 0;
    border-radius: 11px;
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .ts-tab--active {
    background: var(--surface-2);
  }

  .ts-tab-icon {
    font-size: 1.0625rem;
    line-height: 1;
    color: var(--muted);
  }

  .ts-tab--active .ts-tab-icon {
    color: var(--accent);
  }

  .ts-tab-label {
    font-family: var(--font-mono);
    font-size: 0.59375rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .ts-tab--active .ts-tab-label {
    color: var(--eyebrow);
  }

  /* ── Responsive breakpoint (wide AND tall) ───────────────────────────────
     These media blocks MUST come after all base rules above: several
     override properties the base rules also set (display, font-size,
     height), and with equal specificity the later rule wins.

     Master–detail requires the viewport to be wide AND tall (≥720×560) so a
     landscape phone (e.g. 844×390 — wide but short) keeps the one-column
     phone layout. The phone condition is the exact logical complement
     (width < 720 OR height < 560, comma = OR); this subsumes the design
     handoff's separate short-landscape guard, so no third block is needed. */

  /* Phone (narrow OR short): paginated — one pane at a time, via the tab bar */
  @media (max-width: 719.98px), (max-height: 559.98px) {
    .screen { max-width: 430px; }
    .ts-rail { display: none; }

    /* Hero plate becomes the stop-locator map; the photo is not shown here.
       Scoped to [data-has-map] so a coordinate-less stop (no .hero-map in the
       DOM) keeps its photo / contour-art plate instead of rendering blank. */
    .stop-hero[data-has-map] .hero-map { display: block; }
    .stop-hero[data-has-map] .plate-zoom,
    .stop-hero[data-has-map] .plate-img,
    .stop-hero[data-has-map] .plate-svg,
    .stop-hero[data-has-map] .plate-overlay,
    .stop-hero[data-has-map] .plate-footer { display: none; }

    .ts-body[data-phone-view='map'] .ts-rail,
    .ts-body[data-phone-view='stops'] .ts-rail {
      display: flex;
      flex: 1;
      min-width: 0;
    }
    .ts-body[data-phone-view='map'] .ts-detail,
    .ts-body[data-phone-view='stops'] .ts-detail {
      display: none;
    }
    /* Map tab: the map takes the whole pane */
    .ts-body[data-phone-view='map'] .rail-map {
      flex: 1;
      height: auto;
    }
    .ts-body[data-phone-view='map'] .rail-list { display: none; }
    /* Stops tab: the list takes the whole pane */
    .ts-body[data-phone-view='stops'] .rail-map { display: none; }
    .ts-body[data-phone-view='stops'] .rail-list { padding-top: 4px; }
  }

  /* Tablet (wide AND tall): master–detail — rail persistent, no tab bar */
  @media (min-width: 720px) and (min-height: 560px) {
    .ts-rail {
      display: flex;
      width: 400px;
      flex: none;
      border-right: 1px solid var(--border-2);
    }
    .ts-tabs { display: none; }
    .ts-accordions { flex-direction: row; align-items: flex-start; }
    .accordion { flex: 1; }
    .stop-title { font-size: 2.625rem; }  /* 42px (phone 32px) */
    .plate { height: 256px; }             /* phone 196px */
  }

  /* Narrow-short landscape ONLY (<720px wide — e.g. iPhone SE rotated):
     these viewports keep the portrait layout, so minimise its sticky footer
     (design handoff: "Sticky footer in landscape"). Wide-short landscape
     (≥720px) gets the dedicated shell below instead, where the footer
     becomes the right action rail. */
  @media (max-width: 719.98px) and (max-height: 550px) and (orientation: landscape) {
    .proximity-strip { display: none; }
    .nav-row { padding: 10px 16px 10px; }
    .nav-next { height: 46px; }
    .nav-next-label { white-space: nowrap; }
  }

  /* ── Landscape phone shell (design handoff: concept "1a — Edge rails") ──
     Wide but SHORT (≥720px AND <560px, e.g. 844×390): the portrait layout
     letterboxes here, so chrome docks to the sides and content spans the
     full height. Three zones: 76px left nav rail (back / vertical tabs /
     theme toggle) · swappable middle (driven by the SAME phoneView state as
     the portrait tabs) · 150px right action rail (proximity, Prev, Next).

     One DOM: `.screen` becomes a grid and `display: contents` hoists the
     children of .app-header / .ts-body / .ts-detail into it. Because
     .ts-detail is `contents` here, pane visibility retargets .scroll-body
     (NOT .ts-detail, which the phone block above hides in map/stops views —
     that would take the footer rail down with it).

     NOTE: this block matches viewports the phone block above ALSO matches
     (height < 560) — it must stay LAST so its equal-specificity rules win. */
  @media (min-width: 720px) and (max-height: 559.98px) {
    .screen {
      max-width: none;
      display: grid;
      grid-template-columns: 76px 1fr 150px;
      grid-template-rows: auto 1fr auto;
      grid-template-areas:
        'back   middle rail'
        'tabs   middle rail'
        'toggle middle rail';
    }

    /* Left-rail backdrop — a pseudo grid item spanning column 1 */
    .screen::before {
      content: '';
      grid-row: 1 / -1;
      grid-column: 1 / 2;
      background: var(--surface-3);
      border-right: 1px solid var(--border-2);
    }

    .status-bar,
    .progress-bar,
    .header-center { display: none; }

    .app-header { display: contents; }
    .app-header .nav-back {
      grid-area: back;
      justify-self: center;
      margin-top: 12px;
      width: 44px;
      height: 44px;
    }
    .app-header :global(button.toggle) {
      grid-area: toggle;
      justify-self: center;
      margin-bottom: 12px;
    }

    /* Vertical tabs in the rail middle (buttons are already icon-over-label) */
    .ts-tabs {
      grid-area: tabs;
      align-self: center;
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 100%;
      padding: 0 8px;
      border-top: 0;
      background: none;
    }
    .ts-tab { padding: 8px 0; }
    .ts-tab-label {
      font-size: 8px;
      line-height: 1.15;
      text-align: center;
    }

    /* Middle zone: rail panes and the stop detail share one grid area;
       phoneView decides which shows. .ts-detail must stay `contents` in
       every view so the footer rail survives map/stops. */
    .ts-body,
    .ts-detail { display: contents; }
    .ts-body[data-phone-view='map'] .ts-detail,
    .ts-body[data-phone-view='stops'] .ts-detail { display: contents; }

    .ts-rail { grid-area: middle; min-width: 0; }
    .scroll-body { grid-area: middle; min-width: 0; }

    .ts-body[data-phone-view='map'] .scroll-body,
    .ts-body[data-phone-view='stops'] .scroll-body { display: none; }
    .ts-body[data-phone-view='map'] .ts-rail,
    .ts-body[data-phone-view='stops'] .ts-rail { display: flex; }

    /* Stop pane: media plate beside the scrolling text column */
    .scroll-body {
      display: flex;
      flex-direction: row;
      overflow: hidden;
    }
    .plate.stop-hero {
      width: 220px;
      flex: none;
      height: auto;
      margin: 12px 0 12px 12px;
    }
    .detail-content {
      flex: 1;
      min-width: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .ts-accordions { flex-direction: row; align-items: flex-start; }
    .accordion { flex: 1; }

    /* Right action rail: the footer, docked and stacked */
    .footer {
      grid-area: rail;
      display: flex;
      flex-direction: column;
      border-top: 0;
      border-left: 1px solid var(--border-2);
      background: var(--surface-3);
      padding: 14px 12px;
      min-height: 0;
    }
    .proximity-strip {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      padding: 0 2px 10px;
    }
    .proximity-text { font-size: 0.78125rem; }
    .nav-row {
      flex-direction: column;
      gap: 8px;
      padding: 0;
      margin-top: auto;
    }
    .nav-row .nav-sq { width: 100%; height: 44px; }
    .nav-next {
      width: 100%;
      height: auto;
      padding: 12px 10px;
      flex-direction: column;
      gap: 3px;
    }
    .nav-next-name {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      text-align: center;
    }
  }
</style>
