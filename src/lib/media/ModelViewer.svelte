<!--
  3D Model viewer stub.
  Shows a styled placeholder for .glb/.gltf references in stop content.

  TODO: Replace with a dynamic import of <model-viewer> web component:
    const { default: _ } = await import('@google/model-viewer')
    Then render: <model-viewer src={src} camera-controls ar />
  This keeps the default bundle free of the heavy model-viewer dep (~700 KB).
-->
<script lang="ts">
  interface Props {
    src: string
    caption?: string
  }
  const { src, caption }: Props = $props()
  const filename = $derived(src.split('/').pop() ?? '3D model')
</script>

<figure class="model-stub">
  <div class="placeholder" aria-label="3D model: {filename}">
    <span class="icon">⬡</span>
    <p class="label">{filename}</p>
  </div>
  {#if caption}
    <figcaption>{caption}</figcaption>
  {/if}
</figure>

<style>
  .model-stub {
    margin: 0;
  }

  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 2rem 1rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 14px;
    color: var(--muted);
  }

  .icon {
    font-size: 2.5rem;
    opacity: 0.6;
    line-height: 1;
  }

  .label {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.08em;
  }

  figcaption {
    margin-top: 0.5rem;
    font-size: 0.875rem;
    font-style: italic;
    color: var(--muted);
    text-align: center;
  }
</style>
