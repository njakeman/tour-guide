<!--
  Standalone tour navigation — a minimal prev/next + count display.
  Used outside the main stop screen when a compact nav is needed.
-->
<script lang="ts">
  interface Props {
    currentIndex: number
    total: number
    onPrev: () => void
    onNext: () => void
  }
  const { currentIndex, total, onPrev, onNext }: Props = $props()
</script>

<nav class="tour-nav" aria-label="Tour navigation">
  <button
    class="nav-btn"
    onclick={onPrev}
    disabled={currentIndex === 0}
    aria-label="Previous stop"
  >‹</button>

  <span class="nav-count" aria-live="polite">
    Stop {currentIndex + 1} of {total}
  </span>

  <button
    class="nav-btn"
    onclick={onNext}
    disabled={currentIndex === total - 1}
    aria-label="Next stop"
  >›</button>
</nav>

<style>
  .tour-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: var(--footer-bg);
    border-top: 1px solid var(--border-2);
  }

  .nav-btn {
    width: 44px;
    height: 44px;
    border-radius: 12px;
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

  .nav-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .nav-btn:not(:disabled):hover {
    background: var(--surface);
  }

  .nav-count {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.1em;
    color: var(--muted);
    text-align: center;
  }
</style>
