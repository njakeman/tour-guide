<!--
  Stop screen — the core fieldWorks experience.
  Shows: status bar, app header (back, eyebrow, stop count, theme toggle),
  progress bar, hero plate (image or contour fallback), title block with meta chips,
  body HTML, Evidence and Interpretation accordions, proximity footer, and nav.

  Media types in the body HTML (rendered by the plugin):
    .media-img   — image figures
    .media-audio — audio figures
    .media-video — video figures
    .media-model — 3D stubs (data-src/data-caption)
-->
<script lang="ts">
  import type { TourStop } from './types'
  import ThemeToggle from './ThemeToggle.svelte'

  interface Props {
    stop: TourStop
    stopIndex: number
    totalStops: number
    routeName: string
    /** Distance in metres; undefined when no GPS */
    distanceMetres?: number
    /** GPS accuracy in metres; undefined when no GPS */
    accuracy?: number
    onPrev: () => void
    onNext: () => void
    onBack: () => void
  }

  const {
    stop,
    stopIndex,
    totalStops,
    routeName,
    distanceMetres,
    accuracy,
    onPrev,
    onNext,
    onBack,
  }: Props = $props()

  const radius = $derived(stop.proximity_radius ?? 30)
  const isNearby = $derived(
    distanceMetres !== undefined &&
    accuracy !== undefined &&
    accuracy <= radius * 2 &&
    distanceMetres <= radius
  )

  function fmtDistance(m: number): string {
    if (m < 1000) return `${m}m`
    return `${(m / 1000).toFixed(1)} km`
  }

  // Hero image: explicit hero field takes priority
  const heroSrc = $derived(stop.hero?.src ?? stop.media?.find((m) => m.type === 'image')?.src)
  const heroCaption = $derived(stop.hero?.caption ?? stop.media?.find((m) => m.type === 'image')?.caption)
</script>

<div class="screen">
  <!-- Status bar -->
  <div class="status-bar">
    <span>9:41</span>
    <span class="status-right">
      {#if stop.elevation}↑ {stop.elevation} · {/if}⌖ GPS
    </span>
  </div>

  <!-- App header -->
  <div class="app-header">
    <button class="nav-sq" aria-label="Back to route" onclick={onBack}>‹</button>
    <div class="header-center">
      <div class="header-eyebrow">{routeName}</div>
      <div class="header-sub">Stop {stopIndex + 1} of {totalStops}</div>
    </div>
    <ThemeToggle />
  </div>

  <!-- Progress segments -->
  <div class="progress-bar" role="progressbar" aria-valuenow={stopIndex + 1} aria-valuemax={totalStops}>
    {#each Array(totalStops) as _, i}
      <div class="progress-seg" class:progress-seg--done={i <= stopIndex}></div>
    {/each}
  </div>

  <!-- Scrollable body -->
  <div class="scroll-body">

    <!-- Hero plate -->
    <div class="plate">
      {#if heroSrc}
        <img src={heroSrc} alt={heroCaption ?? stop.title} class="plate-img" loading="eager" />
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
        <span class="plate-look-pill" aria-hidden="true">↻ look around</span>
      </div>
    </div>

    <!-- Title block -->
    <div class="title-block">
      {#if stop.era}
        <div class="era-eyebrow">{stop.era}</div>
      {/if}
      <h1 class="stop-title">{stop.title}</h1>

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
      <div class="body-text">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html stop.bodyHtml}
      </div>
    {/if}

    <!-- Accordions -->
    <div class="accordions">
      <details class="accordion" open>
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
        <details class="accordion">
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
  </div>

  <!-- Proximity footer + nav -->
  <footer class="footer">
    <!-- GPS status strip -->
    <div class="proximity-strip">
      {#if distanceMetres !== undefined}
        <span class="ping" aria-hidden="true">
          <span class="ping-dot"></span>
          <span class="ping-ripple"></span>
        </span>
        <span class="proximity-text">
          {#if isNearby}
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
        class="nav-next"
        aria-label="Next stop"
        disabled={stopIndex === totalStops - 1}
        onclick={onNext}
      >
        <span class="nav-next-label">
          {stopIndex === totalStops - 1 ? 'Final stop' : 'Next stop'}
        </span>
        {#if stopIndex < totalStops - 1}
          <span class="nav-next-name">
            · {stop ? '›' : ''}
          </span>
        {/if}
      </button>
    </div>
  </footer>
</div>

<style>
  .screen {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    background: var(--bg);
    max-width: 430px;
    margin: 0 auto;
    overflow: hidden;
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
    height: 212px;
    margin: 0 18px;
    border-radius: 18px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: var(--plate-grad);
    flex: none;
  }

  .plate-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .plate-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .plate-overlay {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: 84px;
    background: linear-gradient(180deg, transparent, rgba(0,0,0,0.55));
  }

  .plate-footer {
    position: absolute;
    left: 14px; bottom: 12px; right: 14px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 10px;
  }

  .plate-caption {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #f6efdd;
    text-shadow: 0 1px 3px rgba(0,0,0,0.5);
  }

  .plate-look-pill {
    font-family: var(--font-mono);
    font-size: 0.65625rem;
    color: #f6efdd;
    background: rgba(0,0,0,0.4);
    border: 1px solid rgba(246,239,221,0.4);
    padding: 3px 8px;
    border-radius: 20px;
    backdrop-filter: blur(2px);
    white-space: nowrap;
    flex: none;
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
    font-size: 2.0625rem;
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
  }
</style>
