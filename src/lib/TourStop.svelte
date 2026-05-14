<script context="module" lang="ts">
  export type TourStopData = {
    id: string
    title: string
    evidence: string
    interpretation?: string
  }
</script>

<script lang="ts">
  export let stop: TourStopData
  export let showInterpretation: boolean = false
</script>

<article>
  <header>
    <h2>{stop.title}</h2>
  </header>

  <section aria-label="Evidence">
    <h3>Evidence</h3>
    <p>{stop.evidence}</p>
  </section>

  {#if showInterpretation && stop.interpretation}
    <section aria-label="Interpretation">
      <h3>Interpretation</h3>
      <p>{stop.interpretation}</p>
    </section>
  {/if}
</article>

<style>
  article {
    max-width: 70ch;
    margin: 0 auto;
    padding: 1rem;
  }

  header {
    margin-bottom: 1rem;
  }

  section {
    margin-top: 1rem;
    padding: 0.75rem;
    border: 1px solid #ddd;
    border-radius: 0.5rem;
  }

  h2 {
    margin: 0;
  }

  h3 {
    margin: 0 0 0.5rem 0;
  }

  p {
    margin: 0;
    line-height: 1.5;
  }
</style>
