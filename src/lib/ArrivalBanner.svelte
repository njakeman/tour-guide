<!--
  Arrival banner — the non-blocking "you've reached a stop" moment (chosen
  over a modal: nothing to dismiss with cold hands; it never blocks the map
  or the scroll). Floats above the footer/tab bar in every layout, announces
  politely to AT, auto-dismisses after 10s. Tapping it opens the stop (or
  just dismisses when it IS the currently open stop).
-->
<script lang="ts">
  import { onMount } from 'svelte'

  interface Props {
    stopTitle: string
    /** True when the arrival is the stop already on screen — no Open action. */
    isCurrent: boolean
    onOpen: () => void
    onDismiss: () => void
  }
  const { stopTitle, isCurrent, onOpen, onDismiss }: Props = $props()

  const AUTO_DISMISS_MS = 10_000

  onMount(() => {
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  })

  function activate() {
    if (isCurrent) onDismiss()
    else onOpen()
  }
</script>

<div class="arrival" role="status" aria-live="polite">
  <button class="arrival-card" type="button" onclick={activate}>
    <span class="arrival-ping" aria-hidden="true"></span>
    <span class="arrival-text">
      <span class="arrival-eyebrow">Arrived</span>
      <span class="arrival-title">{stopTitle}</span>
    </span>
    {#if !isCurrent}
      <span class="arrival-open">Open ›</span>
    {/if}
  </button>
</div>

<style>
  .arrival {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(112px + env(safe-area-inset-bottom));
    z-index: 60; /* above footers/tab bars, below the lightbox (100) */
    width: min(420px, calc(100vw - 28px));
    animation: arrival-in 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.1);
  }

  @keyframes arrival-in {
    from { opacity: 0; transform: translate(-50%, 14px); }
    to   { opacity: 1; transform: translate(-50%, 0); }
  }

  .arrival-card {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 16px;
    border-radius: 15px;
    background: var(--surface-2);
    border: 1.5px solid var(--olive);
    box-shadow: 0 10px 28px -12px rgba(0, 0, 0, 0.45);
    cursor: pointer;
    text-align: left;
  }

  .arrival-ping {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--olive);
    flex: none;
    animation: tg-pulse 2s ease-out infinite;
  }

  .arrival-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .arrival-eyebrow {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--olive);
  }

  .arrival-title {
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .arrival-open {
    flex: none;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent);
    white-space: nowrap;
  }
</style>
