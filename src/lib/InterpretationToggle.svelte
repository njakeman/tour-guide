<script lang="ts">
  export let enabled: boolean
  export let onToggle: () => void
</script>

<div class="toggle">
  <label>
    <input
      type="checkbox"
      checked={enabled}
      onchange={onToggle}
    />
    Show interpretation layer
  </label>
</div>

<style>
  .toggle {
    max-width: 70ch;
    margin: 0 auto 1rem auto;
  }

</style>
