<script context="module" lang="ts">
  import type { MediaItem } from "../content/vite-plugin"

  export type TourStopData = {
    id: string
    title: string
    evidence: string
    interpretation?: string
    body?: string
    media?: MediaItem[]
    lat?: number | null
    lng?: number | null
    proximity_radius?: number
  }
</script>

<script lang="ts">
  import { marked } from "marked"

  export let stop: TourStopData
  export let showInterpretation: boolean = false

  // Register media with the service worker for offline caching
  function registerMediaForOffline(media: MediaItem[]): void {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      for (const item of media) {
        navigator.serviceWorker.controller.postMessage({
          type: 'CACHE_MEDIA',
          url: item.src
        })
      }
    }
  }

  // Ensure media is registered for offline use
  $: if (stop && stop.media) {
    registerMediaForOffline(stop.media)
  }

  // Render markdown body
  $: bodyHtml = stop.body ? marked(stop.body, { async: false }) as string : ''
</script>

<article class:offline={!navigator.onLine}>
  <header>
    <h2>{stop.title}</h2>
  </header>

  {#if stop.media && stop.media.length > 0}
    <section aria-label="Media" class="media-section">
      {#each stop.media as media (media.src)}
        <div class="media-item">
          {#if media.type === 'image'}
            <img src={media.src} alt={media.caption || media.src} loading="lazy" />
            {#if media.caption}
              <p class="caption">{media.caption}</p>
            {/if}
          {:else if media.type === 'audio'}
            <audio controls preload="metadata">
              <source src={media.src} />
              Your browser does not support the audio element.
            </audio>
            {#if media.caption}
              <p class="caption">{media.caption}</p>
            {/if}
          {:else if media.type === 'video'}
            <video controls preload="metadata" playsinline>
              <source src={media.src} />
              Your browser does not support the video element.
            </video>
            {#if media.caption}
              <p class="caption">{media.caption}</p>
            {/if}
          {:else if media.type === 'model'}
            <!-- 3D model viewer placeholder - could integrate with Three.js or Babylon.js -->
            <div class="model-placeholder">
              <p>3D Model: {media.src}</p>
              {#if media.caption}
                <p class="caption">{media.caption}</p>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </section>
  {/if}

  <section class="body" aria-label="Description">
    {#if bodyHtml}
      <div>{@html bodyHtml}</div>
    {/if}
  </section>

  <section aria-label="Evidence" class="evidence-interp">
    <details open={true}>
      <summary>
        <h3>Evidence</h3>
      </summary>
      <p>{stop.evidence}</p>
    </details>

    {#if showInterpretation && stop.interpretation}
      <details open={true}>
        <summary>
          <h3>Interpretation</h3>
        </summary>
        <p>{stop.interpretation}</p>
      </details>
    {/if}
  </section>
</article>

<style>
  article {
    max-width: 70ch;
    margin: 0 auto;
    padding: 1rem;
  }

  article.offline {
    border-left: 4px solid #f59e0b;
  }

  header {
    margin-bottom: 1.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1.75rem;
    color: #2d3748;
  }

  h3 {
    margin: 0;
    font-size: 1.125rem;
    display: inline;
  }

  section {
    margin-top: 1.5rem;
  }

  details {
    border: 1px solid #e2e8f0;
    border-radius: 0.5rem;
    padding: 1rem;
    margin-bottom: 1rem;
    background: #f7fafc;
  }

  details:last-child {
    margin-bottom: 0;
  }

  summary {
    cursor: pointer;
    font-weight: 600;
    color: #4a5568;
  }

  summary > h3 {
    display: inline;
  }

  summary:hover {
    color: #2d3748;
  }

  p {
    margin: 0;
    line-height: 1.6;
    color: #4a5568;
  }

  .evidence-interp {
    margin-top: 2rem;
  }

  .media-section {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    margin: 1.5rem 0 2rem 0;
  }

  .media-item {
    border-radius: 0.5rem;
    overflow: hidden;
    background: #f7fafc;
  }

  .media-item img,
  .media-item video {
    width: 100%;
    height: auto;
    display: block;
  }

  .media-item audio {
    width: 100%;
    padding: 0.5rem;
  }

  .media-item .model-placeholder {
    padding: 1rem;
    text-align: center;
    background: #edf2f7;
    color: #718096;
  }

  .caption {
    margin-top: 0.5rem;
    font-size: 0.875rem;
    font-style: italic;
    color: #718096;
    padding: 0 0.75rem 0.75rem 0.75rem;
  }

  .body {
    line-height: 1.7;
    color: #2d3748;
  }

  .body :global(h1),
  .body :global(h2),
  .body :global(h3) {
    font-size: 1.25rem;
    margin-top: 1.5rem;
    margin-bottom: 0.75rem;
    color: #2d3748;
  }

  .body :global(p) {
    margin-bottom: 1rem;
  }

  .body :global(ul),
  .body :global(ol) {
    margin-bottom: 1rem;
    padding-left: 1.5rem;
  }

  .body :global(strong) {
    color: #1a202c;
  }

  .body :global(blockquote) {
    border-left: 4px solid #4a5568;
    margin: 1.5rem 0;
    padding: 0.5rem 1rem;
    background: #edf2f7;
    font-style: italic;
    color: #4a5568;
  }

  .body :global(blockquote p) {
    margin: 0;
  }
</style>