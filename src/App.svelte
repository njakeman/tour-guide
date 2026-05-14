<script lang="ts">
  import TourStop from "./lib/TourStop.svelte"
  import TourNav from "./lib/TourNav.svelte"
  import InterpretationToggle from "./lib/InterpretationToggle.svelte"
  import { stops } from "./lib/data/stops"

  let showInterpretation = true
  let currentIndex = 0

  $: currentStop = stops[currentIndex]

  function prev() {
    if (currentIndex > 0) currentIndex -= 1
  }

  function next() {
    if (currentIndex < stops.length - 1) currentIndex += 1
  }

  function toggleInterpretation() {
    showInterpretation = !showInterpretation
  }


</script>


<main>
<InterpretationToggle
  enabled={showInterpretation}
  onToggle={toggleInterpretation}
/>


<TourStop stop={currentStop} {showInterpretation} />

<TourNav
  {currentIndex}
  total={stops.length}
  onPrev={prev}
  onNext={next}
/>

</main>


<style>
  main {
    padding: 1rem;
  }


</style>
