<script lang="ts">
  import TourNav from "./TourNav.svelte"
  import InterpretationToggle from "./InterpretationToggle.svelte"

  export let currentIndex: number
  export let total: number

  export let showInterpretation: boolean

  export let onPrev: () => void
  export let onNext: () => void
  export let onToggleInterpretation: () => void
</script>

<section aria-label="Tour controls">
  <InterpretationToggle
    enabled={showInterpretation}
    onToggle={onToggleInterpretation}
  />

  <TourNav
    {currentIndex}
    {total}
    onPrev={onPrev}
    onNext={onNext}
  />
</section>

<style>
  section {
    margin-top: 1rem;
  }
</style>
