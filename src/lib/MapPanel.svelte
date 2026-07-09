<!--
  Map panel — MapLibre GL map with a local PMTiles raster basemap, falling
  back to an inline SVG schematic (contour rings, dashed route, numbered pins).

  Shared by the route overview (RouteMap) and the responsive stop screen
  (TourStop rail). Fills its parent; the parent supplies the size.

  Lazy initialisation (the "hidden map" bug): under the responsive model the
  map exists in the DOM at every width but may be display:none (phone, behind
  the Map tab). MapLibre initialised in a zero-size container renders blank —
  so the map is only created once the container first has a real size
  (ResizeObserver), and map.resize() is called on later size changes (tab
  reveal, 720px breakpoint flip, orientation change). One instance, torn down
  on unmount.

  `center`/`zoom`/`label` let a caller focus the map on something other than
  the route default (e.g. the phone stop-hero centres on the current stop) —
  every existing call site is unaffected since these are optional.
  `showUserLocation` renders the live GPS fix as the walker locator (a
  MapLibre HTML Marker driven by the `geolocation` store; reticle + heading
  cone, see src/lib/map/markers.ts); the map is never recentred on it since
  the offline PMTiles cache only covers a fixed area and panning must stay
  under the user's control.

  Every stop with coordinates gets a numbered chalk-disc marker (design
  handoff: "Map Markers"). Tapping a marker opens the stop popup (one at a
  time; map tap closes it); tapping the popup navigates to that stop.
-->
<script lang="ts" module>
  // maplibre-gl's global protocol registry is shared across every mounted
  // MapPanel. TourStop mounts two at once (rail + phone hero), so a naive
  // addProtocol/removeProtocol per instance means the first panel to tear
  // down pulls the pmtiles protocol out from under the survivor, breaking
  // its subsequent tile fetches. Ref-count it: register on first acquire,
  // remove only when the last panel releases.
  // The bits of the maplibre-gl default export we touch outside init (the full
  // default export type isn't cleanly reachable as `import(...)['default']`
  // because maplibre-gl types export via `export =`).
  interface MaplibreGlLike {
    Marker: new (options?: any) => import('maplibre-gl').Marker
    addProtocol(name: string, handler: any): void
    removeProtocol(name: string): void
  }
  type PmtilesProtocolClass = typeof import('pmtiles')['Protocol']

  let pmtilesRefCount = 0

  function acquirePmtilesProtocol(
    maplibregl: MaplibreGlLike,
    ProtocolClass: PmtilesProtocolClass,
  ): () => void {
    if (pmtilesRefCount === 0) {
      const protocol = new ProtocolClass()
      maplibregl.addProtocol('pmtiles', protocol.tile)
    }
    pmtilesRefCount++
    let released = false
    return () => {
      if (released) return
      released = true
      if (--pmtilesRefCount === 0) maplibregl.removeProtocol('pmtiles')
    }
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import type { Map as MaplibreMap, Marker as MaplibreMarker, StyleSpecification } from 'maplibre-gl'
  import type { TourRoute, TourStop } from './types'
  import { geolocation, haversineDistance, type GeoPosition } from './geo/store'
  import { online } from './offline/store'
  import { buildMapStyle, mapZoomRange, isFatalMapError } from './map/style'
  import {
    createStopMarkerElement,
    createStopPopupElement,
    createWalkerLocatorElement,
    setWalkerHeading,
    updateStopPopupDistance,
  } from './map/markers'

  interface Props {
    route: TourRoute
    currentStopId: string | null
    visitedStopIds: Set<string>
    onGoToStop: (stopId: string) => void
    /** Override route.map.center — used by the phone stop-hero focused map. */
    center?: [number, number]
    /** Override route.map.zoom. */
    zoom?: number
    /** Override the default "Route map for {route.name}" aria-label. Needed
     * whenever more than one MapPanel is mounted at once (e.g. the TourStop
     * rail map + the phone hero map) so accessible names stay unique. */
    label?: string
    /** Show the live GPS position as the walker locator. Never recentres the
     * map on it — the offline tile cache only covers a fixed area, so panning
     * stays under the user's control. */
    showUserLocation?: boolean
    /** DOM id for the root element. Defaults to the design handoff's stable
     * `#tour-map` mount hook — override when more than one MapPanel is
     * mounted at once (e.g. the TourStop rail map + the phone hero map)
     * so ids stay unique. */
    id?: string
  }
  const {
    route,
    currentStopId,
    visitedStopIds,
    onGoToStop,
    center: centerOverride,
    zoom: zoomOverride,
    label,
    showUserLocation = true,
    id = 'tour-map',
  }: Props = $props()

  const ariaLabel = $derived(label ?? `Route map for ${route.name}`)

  /** Whether to fall back to the SVG (no basemap, no WebGL, or init/load error) */
  let mapFailed = $state(false)
  /** True once the first frame has rendered — hides the SVG loading state */
  let mapReady = $state(false)
  /** The wrapper we observe for size, and the element MapLibre mounts into */
  let wrapEl: HTMLDivElement | undefined = $state(undefined)
  let mapEl: HTMLDivElement | undefined = $state(undefined)

  // Refs shared between onMount's async init and the reactive $effect below.
  // Plain lets (not $state): the effect is driven by prop/mapReady changes and
  // just reads whichever instance currently exists.
  let mapInstance: MaplibreMap | null = null
  let maplibreLib: MaplibreGlLike | null = null
  // Last center/zoom actually pushed to the map, so incidental parent
  // re-renders (which recreate the center array literal) don't yank the
  // viewport back — only genuine value changes call setCenter/setZoom.
  let appliedCenterKey = ''
  let appliedZoom: number | undefined

  // Keep a live map in sync when the focused stop changes without a remount —
  // the phone stop-hero map's center/zoom are swapped by Prev/Next (App.svelte
  // keeps the same MapPanel instance within a route), so the constructor
  // values read once in onMount would otherwise leave it stuck on the first stop.
  $effect(() => {
    const center = centerOverride
    const zoom = zoomOverride
    if (!mapReady || !mapInstance) return
    const key = center ? `${center[0]},${center[1]}` : ''
    if (center && key !== appliedCenterKey) {
      mapInstance.setCenter(center)
      appliedCenterKey = key
    }
    if (zoom != null && zoom !== appliedZoom) {
      mapInstance.setZoom(zoom)
      appliedZoom = zoom
    }
  })

  onMount(() => {
    // No basemap configured for this tour — show SVG immediately
    if (!route.map?.basemap) {
      mapFailed = true
      return
    }
    const basemap = route.map.basemap

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

    let disposed = false
    let initStarted = false
    let removeProtocol: (() => void) | null = null
    let userMarker: MaplibreMarker | null = null
    let unsubscribeGeo: (() => void) | null = null
    let stopMarkers: MaplibreMarker[] = []
    let popupMarker: MaplibreMarker | null = null
    let popupFor: { stop: TourStop; label: string; el: HTMLElement } | null = null
    let lastFix: GeoPosition | null = null

    function closePopup() {
      popupMarker?.remove()
      popupMarker = null
      popupFor = null
    }

    function fail() {
      mapFailed = true
      unsubscribeGeo?.()
      unsubscribeGeo = null
      userMarker?.remove()
      userMarker = null
      closePopup()
      for (const m of stopMarkers) m.remove()
      stopMarkers = []
      mapInstance?.remove()
      mapInstance = null
      maplibreLib = null
      removeProtocol?.()
      removeProtocol = null
    }

    // maplibre-gl (~800 KB) is loaded on demand so the app shell stays small;
    // the SVG schematic doubles as the loading state.
    async function init() {
      try {
        // OpenFreeMap base layer under the tour raster — network-only tiles,
        // so only merged in when we're connected. Decided once per map init
        // (no live re-style on connectivity change — future work). The style
        // JSON rides its own precached async chunk; a failed chunk fetch
        // (cold cache + a lying navigator.onLine) degrades to pmtiles-only.
        const wantBase = get(online)
        const [maplibreModule, pmtilesModule, baseStyle] = await Promise.all([
          import('maplibre-gl'),
          import('pmtiles'),
          wantBase
            ? import('./map/fieldworks-minimal.style.json')
                .then((m) => m.default as unknown as StyleSpecification)
                .catch(() => null)
            : Promise.resolve(null),
        ])
        await import('maplibre-gl/dist/maplibre-gl.css')
        if (disposed || !mapEl) return

        const maplibregl = maplibreModule.default
        maplibreLib = maplibregl
        removeProtocol = acquirePmtilesProtocol(maplibregl, pmtilesModule.Protocol)

        const center: [number, number] = centerOverride ?? route.map?.center ?? [-0.375, 50.858]
        const zoom = zoomOverride ?? route.map?.zoom ?? 14
        appliedCenterKey = `${center[0]},${center[1]}`
        appliedZoom = zoom

        mapInstance = new maplibregl.Map({
          container: mapEl,
          style: buildMapStyle(basemap, baseStyle),
          center,
          zoom,
          ...mapZoomRange(baseStyle != null),
          attributionControl: { compact: true },
        })

        mapInstance.on('load', () => {
          if (disposed || !mapInstance) return
          mapReady = true

          // Numbered chalk-disc stop markers (design handoff: "Map Markers").
          // Pin tip at the element's bottom-centre → anchor 'bottom'. Tap
          // opens the popup; tapping the popup navigates to the stop.
          route.stops.forEach((stop, i) => {
            if (stop.lat == null || stop.lng == null || !mapInstance) return
            const label = String(i + 1)
            const el = createStopMarkerElement(label, stop.title)
            el.addEventListener('click', (e) => {
              // Markers live inside the map's canvas container — stop the
              // event before the map's own click handler closes the popup.
              e.stopPropagation()
              openPopup(stop, label)
            })
            stopMarkers.push(
              new maplibregl.Marker({ element: el, anchor: 'bottom' })
                .setLngLat([stop.lng, stop.lat])
                .addTo(mapInstance)
            )
          })

          function openPopup(stop: TourStop, label: string) {
            if (!mapInstance || stop.lat == null || stop.lng == null) return
            closePopup() // one popup at a time
            const el = createStopPopupElement({
              label,
              title: stop.title,
              distanceMetres: lastFix
                ? haversineDistance(lastFix.lat, lastFix.lng, stop.lat, stop.lng)
                : null,
            })
            el.addEventListener('click', (e) => {
              e.stopPropagation()
              closePopup()
              onGoToStop(stop.id)
            })
            // Bottom-anchored just above the 49px pin, tail pointing at the disc
            popupMarker = new maplibregl.Marker({
              element: el,
              anchor: 'bottom',
              offset: [0, -53],
            })
              .setLngLat([stop.lng, stop.lat])
              .addTo(mapInstance)
            popupFor = { stop, label, el }
          }

          // Tapping the map (not a marker) dismisses the popup
          mapInstance.on('click', closePopup)

          // Live GPS position — the walker locator (reticle + heading cone).
          // Never recentres the map: the offline tile cache only covers a
          // fixed area, so the viewport stays under the user's control.
          if (showUserLocation && mapInstance) {
            const el = createWalkerLocatorElement()
            el.style.display = 'none' // hidden until the first fix
            userMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
              .setLngLat([0, 0])
              .addTo(mapInstance)
            const marker = userMarker
            unsubscribeGeo = geolocation.subscribe((state) => {
              lastFix = state.position
              if (!state.position) {
                el.style.display = 'none'
                return
              }
              marker.setLngLat([state.position.lng, state.position.lat])
              el.style.display = ''
              // Map is north-up; only the cone rotates, hidden with no bearing
              setWalkerHeading(el, state.position.heading ?? null)
              // Keep an open popup's "· 320m away" eyebrow honest as we move
              if (popupFor && popupFor.stop.lat != null && popupFor.stop.lng != null) {
                updateStopPopupDistance(
                  popupFor.el,
                  popupFor.label,
                  haversineDistance(
                    state.position.lat,
                    state.position.lng,
                    popupFor.stop.lat,
                    popupFor.stop.lng
                  )
                )
              }
            })
          }
        })
        // Async failures (basemap 404, offline with a cold cache, corrupt
        // tiles) surface here, not in the constructor. Fall back to the SVG
        // only before first render; ignore transient tile errors afterwards.
        // With the OFM base merged in, only errors attributable to the tour
        // basemap source are fatal — a flaky OpenFreeMap must never take
        // down a healthy pmtiles map (see isFatalMapError).
        mapInstance.on('error', (e) => {
          if (disposed) return
          if (!mapReady && isFatalMapError(e, baseStyle != null)) fail()
        })
      } catch {
        fail()
      }
    }

    // Defer creation until the container actually has a size; afterwards
    // keep MapLibre in sync with size changes.
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && wrapEl) {
      observer = new ResizeObserver(() => {
        if (!wrapEl) return
        const { clientWidth, clientHeight } = wrapEl
        if (clientWidth > 0 && clientHeight > 0) {
          if (!initStarted) {
            initStarted = true
            void init()
          } else {
            mapInstance?.resize()
          }
        }
      })
      observer.observe(wrapEl)
    } else {
      // No ResizeObserver (very old browser): init immediately, best effort
      initStarted = true
      void init()
    }

    // Teardown — prevents leaks when hash-routing between views
    return () => {
      disposed = true
      observer?.disconnect()
      unsubscribeGeo?.()
      userMarker?.remove()
      closePopup()
      for (const m of stopMarkers) m.remove()
      stopMarkers = []
      mapInstance?.remove()
      mapInstance = null
      maplibreLib = null
      removeProtocol?.()
      removeProtocol = null
    }
  })

  // ── SVG fallback geometry ────────────────────────────────────────────────
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
      x: PAD + (((s.lng ?? minLng) - minLng) / lngRange) * (VW - PAD * 2),
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
    // Current wins over done: the stop being viewed is marked visited
    // immediately, but must still read as "you are here"
    if (stopId === currentStopId) return 'current'
    if (visitedStopIds.has(stopId)) return 'done'
    return 'upcoming'
  }
</script>

<!-- #tour-map: stable mount id from the design handoff (overridable — see `id` prop) -->
<div class="map-panel" {id} bind:this={wrapEl}>
  {#if route.map?.basemap && !mapFailed}
    <!-- MapLibre GL map — real raster basemap from local PMTiles file -->
    <div class="map-canvas" bind:this={mapEl} role="img" aria-label={ariaLabel}></div>
  {/if}
  {#if mapFailed || !mapReady}
    <!-- SVG schematic: fallback (no basemap, no WebGL, load error) and
         loading state while maplibre-gl is dynamically imported. When a real
         map is coming (not failed), the SVG is only a loading skin, so it's
         hidden from AT — the canvas above carries the accessible name. -->
    <svg
      class="map-svg"
      viewBox="0 0 {VW} {VH}"
      preserveAspectRatio="xMidYMid slice"
      aria-label={mapFailed ? ariaLabel : undefined}
      role={mapFailed ? 'img' : undefined}
      aria-hidden={mapFailed ? undefined : 'true'}
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
          class="tour-map__pin"
          data-stop-index={pin.index}
          role="button"
          tabindex="0"
          aria-label="Stop {pin.label}: {route.stops[pin.index]?.title}"
          onclick={() => onGoToStop(pin.stopId)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onGoToStop(pin.stopId)
            }
          }}
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

<style>
  .map-panel {
    position: relative;
    width: 100%;
    height: 100%;
    background: var(--map-bg);
  }

  /* Canvas and SVG stack so the schematic doubles as the loading state */
  .map-svg,
  .map-canvas {
    display: block;
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
</style>
