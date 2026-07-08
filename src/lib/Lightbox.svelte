<!--
  Full-screen image lightbox. Rendered as a direct child of a screen root
  (outside any .scroll-body) — the document itself never scrolls in this app
  (.screen is height:100dvh + overflow:hidden), so no body scroll-lock is
  needed; overscroll-behavior stops chained scrolling on touch.

  Plain fixed overlay rather than <dialog> so behaviour is identical under
  jsdom in component tests. The close button is the only focusable element,
  so the "focus trap" is simply keeping focus on it.
-->
<script lang="ts">
  import { onMount } from 'svelte'

  interface Props {
    src: string
    alt: string
    caption?: string
    onClose: () => void
  }

  const { src, alt, caption, onClose }: Props = $props()

  let rootEl = $state<HTMLElement | null>(null)
  let closeBtn = $state<HTMLButtonElement | null>(null)

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'Tab') {
      // Single focusable element — keep focus on the close button
      event.preventDefault()
      closeBtn?.focus()
    }
  }

  onMount(() => {
    const trigger = document.activeElement as HTMLElement | null
    closeBtn?.focus()

    // Programmatic listener: a template onclick on the backdrop div would
    // trip svelte-check's static-element-interaction a11y warnings.
    const onBackdropClick = (event: MouseEvent) => {
      const target = event.target as Element
      if (!target.closest('.lightbox-figure') && !target.closest('.lightbox-close')) {
        onClose()
      }
    }
    rootEl?.addEventListener('click', onBackdropClick)

    return () => {
      rootEl?.removeEventListener('click', onBackdropClick)
      trigger?.focus?.()
    }
  })
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="lightbox"
  role="dialog"
  aria-modal="true"
  aria-label={caption ?? alt}
  bind:this={rootEl}
>
  <button
    class="lightbox-close"
    type="button"
    aria-label="Close image"
    bind:this={closeBtn}
    onclick={onClose}
  >×</button>
  <figure class="lightbox-figure">
    <img {src} {alt} />
    {#if caption}
      <figcaption>{caption}</figcaption>
    {/if}
  </figure>
</div>

<style>
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 1000; /* nothing else in the app exceeds z-index: 2 */
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(12, 11, 9, 0.92);
    overscroll-behavior: contain;
    cursor: zoom-out;
  }

  .lightbox-figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    max-width: 100vw;
    cursor: default;
  }

  .lightbox-figure img {
    max-width: 100vw;
    max-height: calc(100dvh - 72px);
    object-fit: contain;
  }

  .lightbox-figure figcaption {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #f6efdd;
    text-align: center;
    padding: 0 16px;
  }

  .lightbox-close {
    position: absolute;
    top: calc(12px + env(safe-area-inset-top));
    right: 14px;
    width: 46px;
    height: 46px;
    border-radius: 14px;
    border: 1px solid rgba(246, 239, 221, 0.25);
    background: rgba(246, 239, 221, 0.08);
    color: #f6efdd;
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .lightbox-close:hover,
  .lightbox-close:focus-visible {
    background: rgba(246, 239, 221, 0.18);
  }
</style>
