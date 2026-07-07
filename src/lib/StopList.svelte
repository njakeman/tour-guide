<!--
  Stop list — route progress rows with done / current / upcoming states.
  Shared by the route overview (RouteMap) and the responsive stop screen's
  rail (TourStop). Hook names per the design handoff: .stop-list,
  .stop-list__item[data-stop-index][data-state], aria-current on the active row.
-->
<script lang="ts">
  import type { TourRoute } from './types'

  interface Props {
    route: TourRoute
    currentStopId: string | null
    visitedStopIds: Set<string>
    onGoToStop: (stopId: string) => void
    /** Distance in metres to the current stop, shown on the active row */
    activeDistanceMetres?: number
  }
  const { route, currentStopId, visitedStopIds, onGoToStop, activeDistanceMetres }: Props = $props()

  function stopStatus(stopId: string): 'done' | 'current' | 'upcoming' {
    // Current wins over done: the stop being viewed is marked visited
    // immediately, but must still read as "you are here"
    if (stopId === currentStopId) return 'current'
    if (visitedStopIds.has(stopId)) return 'done'
    return 'upcoming'
  }

  function fmtDistance(m: number): string {
    if (m < 1000) return `${m}m`
    return `${(m / 1000).toFixed(1)} km`
  }
</script>

<div class="stop-list">
  {#each route.stops as stop, i (stop.id)}
    {@const status = stopStatus(stop.id)}
    <button
      class="stop-list__item stop-row"
      class:stop-row--done={status === 'done'}
      class:stop-row--current={status === 'current'}
      data-stop-index={i}
      data-state={status === 'current' ? 'active' : status}
      onclick={() => onGoToStop(stop.id)}
      aria-label="{status === 'current' ? 'Current: ' : ''}{stop.title}"
      aria-current={status === 'current' ? 'step' : undefined}
    >
      <span
        class="stop-num"
        class:stop-num--done={status === 'done'}
        class:stop-num--current={status === 'current'}
        aria-hidden="true"
      >
        {status === 'done' ? '✓' : i + 1}
      </span>
      <span class="stop-content">
        <span class="stop-title">{stop.title}</span>
        {#if status === 'current'}
          <span class="stop-sub">
            you are here{#if activeDistanceMetres !== undefined} · {fmtDistance(activeDistanceMetres)}{/if}
          </span>
        {/if}
      </span>
      {#if stop.walk_time && status === 'upcoming'}
        <span class="stop-time">{stop.walk_time}</span>
      {/if}
      {#if status === 'current'}
        <span class="stop-arrow" aria-hidden="true">›</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .stop-list {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .stop-row {
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 11px 14px;
    border-radius: 13px;
    background: var(--surface);
    border: 1px solid var(--border-2);
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: border-color 0.15s;
  }

  .stop-row--done {
    opacity: 0.65;
  }

  .stop-row--current {
    border: 1.5px solid var(--accent);
    box-shadow: 0 6px 16px -10px color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .stop-num {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--muted);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    flex: none;
    font-weight: 600;
  }

  .stop-num--done {
    background: var(--pin-done);
    border-color: var(--pin-done);
    color: var(--bg);
  }

  .stop-num--current {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
    width: 28px;
    height: 28px;
    font-size: 0.8125rem;
    font-weight: 700;
  }

  .stop-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .stop-title {
    font-size: 0.9375rem;
    color: var(--text);
    font-weight: 600;
    line-height: 1.3;
  }

  .stop-sub {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--eyebrow);
  }

  .stop-time {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    color: var(--muted);
    white-space: nowrap;
  }

  .stop-arrow {
    font-size: 1.125rem;
    color: var(--accent);
  }
</style>
