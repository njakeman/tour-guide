<script lang="ts">
  export let currentIndex: number
  export let total: number
  export let onPrev: () => void
  export let onNext: () => void
</script>

<nav aria-label="Tour navigation">
  <button on:click={onPrev} disabled={currentIndex === 0}>
    Previous
  </button>

  <span>
    Stop {currentIndex + 1} of {total}
  </span>

  <button on:click={onNext} disabled={currentIndex === total - 1}>
    Next
  </button>
</nav>

<style>
  nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    max-width: 70ch;
    margin: 1.5rem auto 0 auto;
    gap: 1rem;
  }

  button:disabled {
    opacity: 0.5;
  }
</style>
