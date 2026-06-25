<!--
  Route Map — overview screen for a selected tour.

  Map panel: attempts to mount a MapLibre GL map with a local PMTiles raster
  basemap when `route.map.basemap` is set. Falls back to a static inline-SVG
  schematic (contour rings, dashed route path, numbered pins) when:
    • `route.map` is absent (no basemap configured for this tour), or
    • the browser has no WebGL support, or
    • MapLibre throws on initialisation.

  Below the map: stop list with done/current/upcoming states and a Resume button.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import maplibregl from 'maplibre-gl'
  import 'maplibre-gl/dist/maplibre-gl.css'
  import { Protocol } from 'pmtiles'
  import type { TourRoute } from './types'
  import ThemeToggle from './ThemeToggle.svelte'

  interface Props {
    route: TourRoute
    currentStopId: string | null
    visitedStopIds: Set<string>
    onBack: () => void
    onGoToStop: (stopId: string) => void
  }
  const { route, currentStopId, visitedStopIds, onBack, onGoToStop }: Props = $props()

  // ── MapLibre state ────────────────────────────────────────────────────────
  /** Whether to fall back to the SVG (no basemap, no WebGL, or init error) */
  let mapFailed = $state(false)
  /** The DOM element MapLibre mounts into */
  let mapEl: HTMLDivElement | undefined = $state(undefined)

  onMount(() => {
    // No basemap configured for this tour — show SVG immediately
    if (!route.map?.basemap) {
      mapFailed = true
      return
    }

    // WebGL feature detection
    try {
      const canvas = document.createElement('canvas')
      const hasWebGL =
        !!canvas.getContext('webgl2') || !!canvas.getContext('webgl')
      if (!hasWebGL) {
        mapFailed = true
        return
      }
    } catch {
      mapFailed = true
      return
    }

    // Register pmtiles protocol with MapLibre
    const protocol = new Protocol()
    maplibregl.addProtocol('pmtiles', protocol.tile)

    let map: maplibregl.Map | null = null

    try {
      const center: [number, number] = route.map.center ?? [-0.375, 50.858]
      const zoom = route.map.zoom ?? 14

      map = new maplibregl.Map({
        container: mapEl!,
        style: {
          version: 8,
          sources: {
            basemap: {
              type: 'raster',
              url: `pmtiles://${route.map.basemap}`,
              tileSize: 256,
              attribution: '© Environment Agency, © OpenStreetMap contributors',
            },
          },
          layers: [
            {
              id: 'basemap',
              type: 'raster',
              source: 'basemap',
            },
          ],
        },
        center,
        zoom,
        minZoom: 11,
        maxZoom: 17,
        attributionControl: { compact: true },
      })
    } catch {
      mapFailed = true
      map?.remove()
      map = null
      maplibregl.removeProtocol('pmtiles')
    }

    // Teardown — prevents leaks when hash-routing between views
    return () => {
      map?.remove()
      map = null
      maplibregl.removeProtocol('pmtiles')
    }
  })

  // ── SVG map geometry ─────────────────────────────────────────────────────
  const VW = 330
  const VH = 236
  const PAD = 28

  // Normalise lat/lng of stops to [PAD, VW-PAD] × [PAD, VH-PAD]
  type Point = { x: number; y: number; index: number; stopId: string; label: string }

  const pins = $derived.by<Point[]>(() => {
    const stops = route.stops
    const coords = stops.map((s) => ({ lat: s.lat ?? 0, lng: s.lng ?? 0 }))
    const hasCoords = coords.some((c) => c.lat !== 0 || c.lng !== 0)

    if (!hasCoords) {
      // Evenly space pins along a gentle arc as a fallback
      return stops.map((s, i) => {
        const t = stops.length > 1 ? i / (stops.length - 1) : 0.5
        return {
          x: PAD + t * (VW - PAD * 2),
          y: VH / 2 + Math.sin(t * Math.PI) * -40,
          index: i,
          stopId: s.id,
          label: String(i + 1),
        }
      })
    }

    const lats = coords.map((c) => c.lat)
    const lngs = coords.map((c) => c.lng)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs)
    const maxLng = Math.max(...lngs)
    const latRange = maxLat - minLat || 0.001
    const lngRange = maxLng - minLng || 0.001

    return stops.map((s, i) => ({
      // lat: higher = up (invert y-axis)
      x: PAD + ((( s.lng ?? minLng) - minLng) / lngRange) * (VW - PAD * 2),
      y: VH - PAD - (((s.lat ?? minLat) - minLat) / latRange) * (VH - PAD * 2),
      index: i,
      stopId: s.id,
      label: String(i + 1),
    }))
  })

  // Build a smooth route path through the pins
  const routePath = $derived.by<string>(() => {
    const pts = pins
    if (pts.length === 0) return ''
    if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`
    let d = `M${pts[0].x},${pts[0].y}`
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]
      const curr = pts[i]
      const cx1 = prev.x + (curr.x - prev.x) * 0.4
      const cy1 = prev.y
      const cx2 = prev.x + (curr.x - prev.x) * 0.6
      const cy2 = curr.y
      d += ` C${cx1},${cy1} ${cx2},${cy2} ${curr.x},${curr.y}`
    }
    return d
  })

  // Centre of the map for contour rings
  const cx = VW / 2
  const cy = VH / 2

  function stopStatus(stopId: string): 'done' | 'current' | 'upcoming' {
    if (visitedStopIds.has(stopId)) return 'done'
    if (stopId === currentStopId) return 'current'
    return 'upcoming'
  }

  function resumeStop(): void {
    const target = currentStopId ?? route.stops[0]?.id
    if (target) onGoToStop(target)
  }
</script>

<div class="screen">
  <!-- Status bar -->
  <div class="status-bar">
    <span class="status-right">⌖ GPS</span>
  </div>

  <!-- Header -->
  <div class="header">
    <button class="back-btn" aria-label="Back to tour list" onclick={onBack}>‹</button>
    <div class="header-center">
      <div class="route-eyebrow">{route.subtitle ?? route.icon}</div>
      <div class="route-name">{route.name}</div>
    </div>
    <ThemeToggle />
  </div>

  <!-- Map panel -->
  <div class="map-wrap">
    {#if route.map?.basemap && !mapFailed}
      <!-- MapLibre GL map — real raster basemap from local PMTiles file -->
      <div class="map-canvas" bind:this={mapEl} aria-label="Route map for {route.name}"></div>
    {:else}
      <!-- SVG fallback: no basemap configured, WebGL unavailable, or init error -->
      <svg
        class="map-svg"
        viewBox="0 0 {VW} {VH}"
        preserveAspectRatio="xMidYMid slice"
        aria-label="Route map for {route.name}"
        role="img"
      >
        <!-- Background -->
        <rect width={VW} height={VH} fill="var(--map-fill)"/>

        <!-- Decorative contour rings -->
        <g fill="none" stroke="var(--map-stroke)" stroke-width="1.2">
          <ellipse cx={cx} cy={cy} rx="135" ry="98"/>
          <ellipse cx={cx} cy={cy} rx="108" ry="76"/>
          <ellipse cx={cx} cy={cy} rx="82"  ry="56"/>
          <ellipse cx={cx} cy={cy} rx="56"  ry="38"/>
          <ellipse cx={cx} cy={cy} rx="30"  ry="20"/>
        </g>

        <!-- Dashed route path -->
        {#if routePath}
          <path
            d={routePath}
            fill="none"
            stroke="var(--map-route)"
            stroke-width="3"
            stroke-dasharray="1 8"
            stroke-linecap="round"
          />
        {/if}

        <!-- Stop pins -->
        {#each pins as pin (pin.stopId)}
          {@const status = stopStatus(pin.stopId)}
          {@const r = status === 'current' ? 15 : 12}
          <g
            role="button"
            tabindex="0"
            aria-label="Stop {pin.label}: {route.stops[pin.index]?.title}"
            onclick={() => onGoToStop(pin.stopId)}
            onkeydown={(e) => e.key === 'Enter' && onGoToStop(pin.stopId)}
            style="cursor:pointer"
          >
            {#if status === 'current'}
              <circle cx={pin.x} cy={pin.y} r="22" fill="var(--pin-current)" opacity="0.2"/>
            {/if}
            <circle
              cx={pin.x}
              cy={pin.y}
              r={r}
              fill={status === 'done' ? 'var(--pin-done)' : status === 'current' ? 'var(--pin-current)' : 'var(--pin-todo-bg)'}
              stroke={status === 'current' ? 'var(--bg)' : 'none'}
              stroke-width={status === 'current' ? '2' : '0'}
            />
            <text
              x={pin.x}
              y={pin.y}
              text-anchor="middle"
              dominant-baseline="central"
              font-family="var(--font-mono)"
              font-size={status === 'current' ? '11' : '9'}
              font-weight="700"
              fill={status === 'done' ? 'var(--bg)' : status === 'current' ? 'var(--bg)' : 'var(--pin-todo-fg)'}
            >
              {status === 'done' ? '✓' : pin.label}
            </text>
          </g>
        {/each}

        <!-- Map label -->
        <text
          x="12" y="22"
          font-family="var(--font-mono)"
          font-size="8"
          letter-spacing="0.1"
          style="text-transform:uppercase"
          fill="var(--muted)"
        >Survey overview</text>
      </svg>
    {/if}
  </div>

  <!-- Summary chips -->
  <div class="summary">
    <span class="chip">{route.stops.length} stops</span>
    {#if route.total_distance}<span class="chip">{route.total_distance}</span>{/if}
    {#if route.duration}<span class="chip">{route.duration}</span>{/if}
  </div>

  <!-- Stop list -->
  <div class="stop-list">
    {#each route.stops as stop, i (stop.id)}
      {@const status = stopStatus(stop.id)}
      <button
        class="stop-row"
        class:stop-row--done={status === 'done'}
        class:stop-row--current={status === 'current'}
        onclick={() => onGoToStop(stop.id)}
        aria-label="{status === 'current' ? 'Current: ' : ''}{stop.title}"
        aria-current={status === 'current' ? 'step' : undefined}
      >
        <span
          class="stop-num"
          class:stop-num--done={status === 'done'}
          class:stop-num--current={status === 'current'}
          aria-hidden="true"
        >
          {status === 'done' ? '✓' : i + 1}
        </span>
        <span class="stop-content">
          <span class="stop-title">{stop.title}</span>
          {#if status === 'current'}
            <span class="stop-sub">you are here</span>
          {/if}
        </span>
        {#if stop.walk_time && status === 'upcoming'}
          <span class="stop-time">{stop.walk_time}</span>
        {/if}
        {#if status === 'current'}
          <span class="stop-arrow" aria-hidden="true">›</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- Resume button -->
  <div class="resume-wrap">
    <button class="resume-btn" onclick={resumeStop}>
      Resume at stop {route.stops.findIndex((s) => s.id === currentStopId) + 1 || 1}
      <span aria-hidden="true">›</span>
    </button>
  </div>
</div>

<style>
  .screen {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
    background: var(--bg);
    max-width: 430px;
    margin: 0 auto;
  }

  /* Status bar */
  .status-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 26px 6px;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    color: var(--status-text);
    font-weight: 500;
    flex: none;
  }
  .status-right { letter-spacing: 0.05em; }

  /* Header */
  .header {
    padding: 6px 18px 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
  }

  .back-btn {
    width: 46px;
    height: 46px;
    border-radius: 14px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    font-size: 1.375rem;
    color: var(--text);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }

  .header-center {
    flex: 1;
  }

  .route-eyebrow {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--eyebrow);
  }

  .route-name {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 1.375rem;
    color: var(--text);
    line-height: 1.1;
  }

  /* Map */
  .map-wrap {
    margin: 0 18px;
    border-radius: 18px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: var(--map-bg);
    flex: none;
  }

  .map-svg {
    display: block;
    width: 100%;
    height: auto;
  }

  /* MapLibre canvas container — matches the SVG's aspect ratio */
  .map-canvas {
    display: block;
    width: 100%;
    /* 330 × 236 matches the SVG viewBox */
    aspect-ratio: 330 / 236;
  }

  /* Summary chips */
  .summary {
    display: flex;
    gap: 7px;
    padding: 14px 18px 10px;
    flex: none;
    flex-wrap: wrap;
  }

  /* Stop list */
  .stop-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 18px 0;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .stop-row {
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 11px 14px;
    border-radius: 13px;
    background: var(--surface);
    border: 1px solid var(--border-2);
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: border-color 0.15s;
  }

  .stop-row--done {
    opacity: 0.65;
  }

  .stop-row--current {
    border: 1.5px solid var(--accent);
    box-shadow: 0 6px 16px -10px color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .stop-num {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--muted);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    flex: none;
    font-weight: 600;
  }

  .stop-num--done {
    background: var(--pin-done);
    border-color: var(--pin-done);
    color: var(--bg);
  }

  .stop-num--current {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
    width: 28px;
    height: 28px;
    font-size: 0.8125rem;
    font-weight: 700;
  }

  .stop-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .stop-title {
    font-size: 0.9375rem;
    color: var(--text);
    font-weight: 600;
    line-height: 1.3;
  }

  .stop-sub {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--eyebrow);
  }

  .stop-time {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    color: var(--muted);
    white-space: nowrap;
  }

  .stop-arrow {
    font-size: 1.125rem;
    color: var(--accent);
  }

  /* Resume button */
  .resume-wrap {
    padding: 12px 16px 24px;
    flex: none;
  }

  .resume-btn {
    width: 100%;
    height: 56px;
    border-radius: 16px;
    background: var(--accent-btn);
    color: var(--accent-btn-text);
    border: none;
    font-family: var(--font-sans);
    font-weight: 700;
    font-size: 1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: opacity 0.15s;
  }

  .resume-btn:hover {
    opacity: 0.9;
  }
</style>
