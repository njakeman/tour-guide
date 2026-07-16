# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # dev server at http://localhost:5173 (no service worker)
npm run demo:seed    # generate placeholder media for the demo tours into public/tours/ (gitignored)
npm run demo         # demo:seed + dev in one command
npm run check        # svelte-check + tsc (run before committing)
npm run test         # vitest run (single pass)
npx vitest           # vitest watch mode
npm run build        # media:optimize + production build → dist/
npm run media:optimize # generate .webp siblings for public/tours images (runs inside build)
npm run preview      # serve dist/ — the only way to test the service worker
```

To run a single test file:
```bash
npx vitest run src/lib/geo/store.test.ts
```

## Architecture

### Content pipeline (build-time, no runtime fetch)

All tour data is compiled into the JS bundle via a Vite virtual module. The flow:

```
content/routes/<id>/tour.yaml       ← route manifest (stop order, metadata)
content/routes/<id>/stops/<id>.md   ← stop with YAML frontmatter + markdown body
         ↓
src/lib/content/vite-plugin.ts      ← reads YAML + markdown, renders body to HTML
         ↓
virtual:tour-content                ← `import { routes } from 'virtual:tour-content'`
         ↓
App.svelte                          ← consumed at runtime; no network calls for content
```

Markdown image syntax is intercepted at build time: `![caption](file.ext)` is rendered to different HTML elements depending on extension (`.mp3` → `<audio>`, `.mp4` → `<video>`, `.glb` → `.media-model` div, images → `<figure><img>`). This happens in `vite-plugin.ts`.

**Image pipeline:** `scripts/optimize-media.mjs` (first step of `npm run build`)
generates a `.webp` sibling (max 1600px wide, q80, mtime-skipped) for every
png/jpg under `public/tours/`; the siblings are gitignored — CI regenerates
them each deploy. At render time the plugin probes images under `public/`
(`probeImage`: sync `image-size`) to emit intrinsic `width`/`height` +
`decoding="async"`, and upgrades the figure to `<picture>` with a webp
`<source>` when a sibling exists on disk. Stop `hero` objects gain
`width`/`height`/`webpSrc` the same way (rendered as `<picture>` in
TourStop). Dev without running the optimiser degrades to the plain `<img>` —
nothing depends on the script having run. The lightbox opens
`img.currentSrc` so the webp variant (the asset the SW runtime cache holds)
is what full-screens.

Stop files can live at `stops/<id>.md` or with a numbered prefix `stops/01-<id>.md`. The `id:` frontmatter field must match the entry in `tour.yaml`.

Three demo routes exist — `cissbury-ring`, `wolstonbury-hill`, and
`mount-caburn` — each with its own PMTiles basemap in its
`public/tours/<id>/` folder; basemaps are strictly per-tour (`map.basemap` in
each `tour.yaml`; nothing is shared between tours). A route without a `map:`
block is still supported: every map surface renders the inline SVG schematic
fallback (also used on WebGL failure / load error); the save-offline button
renders only when the route has something to save (an `offline` manifest
and/or a basemap).

### Body media at runtime: 3D models + image lightbox

Stop bodies are injected via `{@html stop.bodyHtml}` in `TourStop.svelte`, so
Svelte components can't live inside them. Instead one `$effect` (keyed on
`stop.bodyHtml` — the component is **not keyed** in App.svelte, so prev/next
swaps the body in place) runs a hydration pass over `.body-text`:

- **3D models (`src/lib/media/models.ts`):** `.media-model` stubs (build-time
  output for `.glb`/`.gltf`) are upgraded to `<model-viewer>` elements.
  `@google/model-viewer` is **dynamically imported only when a stub is
  present** — it (plus bundled three) is a ~1 MB async chunk that stays out of
  the app shell but is precached by the SW, so it works offline. If the import
  fails, the ⬡ stub stays visible and the memoised promise resets for a later
  retry. The build-time stub markup in `vite-plugin.ts` must keep
  `class="media-model"`/`data-src`/`data-caption` — `media.test.ts` guards it
  and the hydration reads it.
- **Lightbox (`src/lib/Lightbox.svelte`):** body `.media-img` images get
  `role="button"`/`tabindex` plus delegated click/Enter/Space listeners; the
  hero photo is wrapped in a `.plate-zoom` button. Both open a fixed
  full-screen overlay (Escape / close button / backdrop click to close, focus
  restored to the trigger). It renders as a direct child of `.screen` —
  the document never scrolls in this app, so no scroll lock is needed.
  Gotchas encoded in CSS: `.plate-overlay`/`.plate-footer` are
  `pointer-events: none` so they don't swallow hero clicks, and the phone
  `[data-has-map]` rule hides `.plate-zoom` along with the photo.

### Responsive stop screen (design handoff: "Tour Responsive Proof")

`src/lib/TourStop.svelte` is **one component tree for every size** — a single
breakpoint decides the layout; nothing is added or removed between sizes.
Master–detail requires the viewport to be **wide AND tall** (`≥720px` width
AND `≥560px` height) so a landscape phone (wide but short, e.g. 844×390)
keeps the phone layout; the phone media condition is the exact logical
complement (`(max-width: 719.98px), (max-height: 559.98px)` — comma = OR):

- **Phone (narrow OR short)** — paginated: the stop detail is primary; the map
  and the stop list live behind the bottom tab bar (`Stop / Map & route /
  Stops`, `.ts-tab[data-view]`, local `phoneView` state). Accordions stack
  vertically.
- **Tablet (wide AND tall)** — master–detail: a persistent 400px left rail
  (`.ts-rail`) holds the map + stop list; the detail fills the right; the tab
  bar is hidden; Evidence/Interpretation sit side by side; title 32→42px,
  hero 196→256px.
- **Landscape phone shell** (`min-width: 720px and max-height: 559.98px`,
  design handoff concept "1a — Edge rails") — the same DOM re-laid by CSS
  grid: 76px left nav rail (back button, vertical tabs, theme toggle — hoisted
  out of `.app-header`/`.ts-tabs` via `display: contents`), swappable middle
  (same `phoneView` state as the portrait tabs), 150px right action rail (the
  `footer` docked as a column: proximity readout, Prev, Next). Subtleties:
  `.ts-detail` stays `display: contents` in EVERY view here, so pane
  visibility retargets `.scroll-body` (hiding `.ts-detail` — what the phone
  block does — would take the footer rail down with it); this block matches
  viewports the phone block also matches, so it must stay LAST in the style.
  The `.detail-content` wrapper exists for this layout: `.scroll-body` becomes
  a row (220px media plate beside the scrolling text column).
- **Narrow-short landscape** (`max-width: 719.98px and max-height: 550px and
  landscape`, e.g. iPhone SE rotated) — keeps the portrait layout with a
  minimised sticky footer (proximity line hidden, Next 58→46px).

Shared pieces: `src/lib/MapPanel.svelte` (map + SVG fallback, used by RouteMap
and the TourStop rail; mounts at `#tour-map`) and `src/lib/StopList.svelte`
(progress rows, `.stop-list__item[data-state]`). **CSS ordering matters:** the
two `@media` blocks in TourStop.svelte must stay AFTER the base rules — they
override properties (display/font-size/height) at equal specificity, so source
order decides.

### Responsive Landing (design handoff: tablet master–detail)

`src/lib/TourLibrary.svelte` is the **Landing shell** and applies the same
one-DOM / wide-AND-tall-breakpoint model as the stop screen (RouteMap's
tablet-only cosmetic block uses the same condition). It owns the status
bar + shared app header (wordmark — a button that navigates home via `onBack`,
"Field guide" eyebrow, `ThemeToggle`) and a
`.tl-body[data-phone-view]` split into `.tl-rail` (the card list — "Tours"
title, `.tour-list` of `.tour-card[data-tour][data-state]`, always
distance-sorted nearest-first; no filter buttons) and
`.tl-overview` (which renders `src/lib/RouteMap.svelte`).

- **Phone (narrow OR short)** — paginated: `data-phone-view` (driven by App's
  `view`, `'library' | 'route'`) shows the rail OR the overview. Tapping a card
  calls `onSelect` → `selectRoute` (`#/route`); the overview's phone-only
  `.nav-back` chip returns to the list.
- **Tablet (wide AND tall)** — master–detail: 472px rail + overview both
  visible; the phone's standalone Route page is **folded into the overview**, so
  there is no separate Route view at tablet size. The back chip is hidden.
- **Landscape phone shell** (`min-width: 720px and max-height: 559.98px`,
  design handoff "Landscape Concepts" 3a/3b) — the same DOM re-laid by CSS,
  keyed off `data-view={view}` on the `.screen` root (needed because the
  status bar / app header are siblings *before* `.tl-body`, whose
  `data-phone-view` CSS can't reach them). This band is a subset of the phone
  band, so the phone pane-swap rules still pick the visible pane:
  - **3a Tours home** (`[data-view='library']`): grid `258px 1fr` — left
    identity column (status line, wordmark, "Tours" head, theme toggle at the
    bottom; backdrop painted by `.screen::before`) and the card list as
    **one finger-scrollable vertical column of equal row-cards** (amended
    handoff: no featured/secondary split). Every card is a thumbnail-left
    row; any selected (gradient-header) variant is flattened to the row
    look. The **nearest card is `:first-child`** — the list is always
    nearest-first — and gets the accent highlight (148px thumb, 22px title,
    bottom-anchored chips) regardless of selection; other rows get a 128px
    thumb, centred content, and a `::after` chevron. `.card-dist` (a
    distance eyebrow in the idle-card DOM, `display:none` at every other
    size) shows here on each row. Deviations: the design's inline Start CTA
    and "Nearest" thumb caption are omitted — the card is the tap target,
    Start lives on the overview.
  - **3b Route overview** (`[data-view='route']`): TourLibrary just strips
    its own chrome (status bar/wordmark hidden, `.app-header` →
    `display: contents`) and floats the theme toggle absolute top-right;
    **RouteMap owns the layout** — its own landscape block (same condition,
    last in its `<style>`) re-grids `.tour-overview` to `436px 1fr`
    (`hero`/`map` left; `label`/`meta`/`stops`/`footer` right, backdrop via
    `::before`): the hero collapses to a back-chip + title header row
    (gradient/scrim/dist-badge hidden, on-surface text colours),
    the map fills the left column (`aspect-ratio: auto`), `.ov-desc` is
    hidden, "The route" label becomes the serif pane heading (its right
    padding clears the floating toggle), the stop list is the only scrolling
    region, and the footer docks bottom-right (save square kept — it's the
    only offline-save affordance — with a 52px CTA).

`RouteMap.svelte` is **not a full screen** — it is the overview pane content
(`.tour-overview[data-tour]`: hero, description, meta chips, `MapPanel`,
`StopList`, and the footer with the save-offline square + `.start-tour[data-tour]`
CTA). `App.svelte` renders **one `TourLibrary`** for both the `library` and
`route` views; the `selected` card is `route.id === selectedRouteId`. Same
CSS-ordering rule: the `@media` blocks live at the end of each `<style>`.

### Map — MapLibre GL + PMTiles

`src/lib/MapPanel.svelte` renders a **MapLibre GL** map when `route.map.basemap`
is set in the tour manifest. The basemap is a local PMTiles raster file
(`public/tours/<id>/*.pmtiles`) — no tile server, no network required at runtime.

**Lazy init (hidden-map bug):** because the map exists in the DOM at every
width but may be `display:none` (phone, behind the Map tab), MapPanel defers
`new maplibregl.Map()` until a ResizeObserver first reports a non-zero
container size, and calls `map.resize()` on later size changes (tab reveal,
breakpoint flip, orientation). One instance per mounted panel; never create a
second instance per breakpoint. This also means a MapPanel that stays
`display:none` (e.g. the phone hero map at tablet size, see below) never
instantiates MapLibre at all — no wasted WebGL context.

- `maplibre-gl` and `pmtiles` are **dynamically imported** inside `onMount` so
  the app shell stays small (~80 KB main chunk vs ~1.1 MB with a static import).
  The maplibre chunk is still precached by the SW, so it works offline.
- The PMTiles protocol is registered via the `pmtiles` npm package
  (`Protocol.tile`) and cleaned up on component teardown.
- Falls back to the inline SVG schematic when there is no basemap, WebGL is
  unavailable, MapLibre throws on init, **or an async `map.on('error')` fires
  before first render** (basemap 404, offline with a cold cache). The SVG also
  doubles as the loading state until the map **reveals** — first-of(style
  `load`, tour-basemap `sourcedata` with `isSourceLoaded` → one `render`).
  The second signal exists because `load` waits on **every** style resource
  incl. the OFM sprite/glyphs; on iOS PWAs `navigator.onLine` often lies and
  hung (not failed) OFM fetches would otherwise hide the fully-cached local
  map behind the skeleton indefinitely (`isBasemapRenderableEvent` in
  `src/lib/map/style.ts`). All on-map setup (stop markers, popup wiring,
  walker locator, attribution collapse) runs in the shared idempotent
  `reveal()`, not in the `load` handler — markers are DOM overlays and don't
  need style load. Deliberately no watchdog timeout: if the basemap source
  itself never loads, a blank canvas is worse than the loading SVG.
- **OpenFreeMap base layer** (`src/lib/map/style.ts` + `src/lib/map/fieldworks-minimal.style.json`):
  when the `online` store reports connectivity at map init, the style is the
  OFM vector base (tiles/sprites/glyphs from tiles.openfreemap.org — network-
  only, matches no SW cache rule by design) with the tour's pmtiles raster
  appended LAST so it paints on top; the base shows through outside the
  tileset's bounds/zooms. Decided once per map init — no live re-style on
  connectivity change (future work). The style JSON is **dynamically imported**
  inside `init()` so it rides its own precached async chunk — do NOT move it
  back to `public/` (`.json` is not in the SW glob, it would never precache)
  and do NOT import it statically (would bloat the main chunk). `buildMapStyle`
  clones the style before merging (the dynamic import is one shared module
  instance) and adds the required OpenFreeMap/OpenMapTiles/OSM attribution
  (the JSON ships without one).
- Zoom clamps via `mapZoomRange`: **5–17 with the base layer** (zoom out for
  context), **12–17 pmtiles-only** (the tour tilesets' floor — below z12 they
  have no tiles). No manual layer minzoom is needed — the
  pmtiles protocol's TileJSON carries the header's minzoom/maxzoom/bounds and
  MapLibre never requests raster tiles outside them.
- **Error filter (`isFatalMapError`)**: pre-`load` map errors only drop to the
  SVG fallback when attributable to the tour basemap source
  (`e.sourceId === 'basemap'`) once the base style is merged — a flaky
  OpenFreeMap must never take down a healthy pmtiles map. Sprite failures
  carry NO `sourceId` (network-down sprite errors are bare TypeErrors), so
  unattributed errors fail open; that is safe because the reveal is gated on
  the basemap source, not on `load` (which a dead or hung OFM CAN wedge — see
  above). pmtiles-only mode keeps the original any-error-is-fatal behaviour.
  Future work: SW runtime caching for OFM sprites/glyphs; live re-style on
  connectivity change.
- Use `onMount` (not `$effect`) for map lifecycle to avoid `effect_update_depth_exceeded`.
- **One route per mount:** MapPanel's map lifecycle (and RouteMap's offline-cache
  state) is `onMount`-scoped to the route it mounted with. Any call site where
  the `route` prop can change identity MUST remount via `{#key route.id}` —
  done in TourLibrary (overview pane) and App.svelte (stop view; keyed on route
  only, never the stop — Prev/Next must reuse the instance). Without the key,
  switching tours leaves a blank map pane / stale badges, because `mapReady`
  from the old route suppresses both the canvas and the SVG fallback.
- Each tour supplies its own `.pmtiles` via `map.basemap` in its `tour.yaml` —
  per-route tilesets are the design; nothing is shared between tours. The
  pmtiles SW cache stores multiple files keyed by URL.
- **Debugging gotcha:** MapLibre renders via requestAnimationFrame. In an
  occluded/hidden Chrome window, rAF is frozen, so the `load` event never
  fires and the SVG loading state persists — that is browser throttling, not
  a bug. It resolves the moment the window becomes visible.

**Overrides (`center`, `zoom`, `label`, `showUserLocation`, `id`):**
all optional, all default to the original route-level behaviour, so every
existing call site is unaffected. This lets one `MapPanel` serve three roles:
the TourStop rail map, the RouteMap overview, and the phone stop-hero (below).
`label` overrides the default `"Route map for {route.name}"` aria-label —
required whenever two MapPanels are mounted at once so accessible names (and
the `id` prop, default `tour-map`) don't collide.

**Map markers (design handoff: "Map Markers"):** every stop with coordinates
gets a numbered chalk-disc pin on the live MapLibre map. The DOM builders live
in `src/lib/map/markers.ts` (plain-DOM, jsdom-testable); structural CSS in
`app.css` (`.stop-marker`, `.walker-locator`, `.tour-popup`); all colours are
brand tokens (`--marker-*`, `--locator-*`, `--popup-*`) themed for
light/dark/night in `brand.css`. The pin tip is at the element's bottom-centre
→ MapLibre `anchor: 'bottom'`. Tapping a marker opens the **stop popup** (one
at a time; a map tap closes it; marker/popup click handlers call
`stopPropagation()` because markers live inside the map's canvas container).
The popup eyebrow shows the live haversine distance from the walker ("Stop 3 ·
320m away", falls back to "Stop 3" with no fix) and tapping the popup
navigates to the stop via `onGoToStop`.

**Walker locator:** when `showUserLocation` (default `true`), MapPanel
subscribes to the `geolocation` store (`src/lib/geo/store.ts`) and renders the
GPS fix as the surveyor's-reticle locator (88px, anchored centre) — hidden
until the first fix, then `marker.setLngLat()` on every update. The heading
cone rotates to `position.heading` (degrees from north; the map is north-up —
only the cone turns) and hides when no bearing is available. **The map is
never recentred on the fix** — the offline PMTiles cache only covers a fixed
area, so the viewport must stay under the user's control; panning away from
the locator is expected and does not snap back.

**Phone stop-hero (`TourStop.svelte`):** at phone size (narrow OR short) the
stop's hero plate is a live `MapPanel` centred on the current stop (`center`,
`zoom={16}`) instead of the photo — useful for orientation mid-walk. The
TourStop rail map also passes `center` (no zoom override), so Prev/Next glides
both maps to the active stop via `easeTo` in MapPanel's override `$effect`. At
tablet size (wide AND tall) the hero shows the photo as before, since the rail
map is already permanently visible; the hero `MapPanel` stays `display:none` there
and so never initialises. Both blocks exist in the DOM at every width (`.plate
stop-hero` renders `.hero-map` unconditionally when the stop has coordinates,
alongside the existing `<img>`/SVG); the `@media` blocks at the end of
`TourStop.svelte`'s `<style>` toggle which one is visible.
- A route line drawn directly on the real MapLibre map (rather than only in
  the SVG fallback) remains a future item; stop markers are done (above).

The `map:` field in `tour.yaml` (optional) carries `basemap`, `center` ([lng,lat]), and `zoom`.
The content plugin rewrites `map.basemap` through `withBase()` at build time.

### Routing

Hash-based, no router library. Pure hash parsing/building lives in
`src/lib/router.ts` (`parseHash`, `buildHash`) so it can be unit-tested.
`App.svelte` owns all routing state as Svelte 5 `$state` runes:
- `#/` → `view = 'library'`
- `#/route` → `view = 'route'` (both render the same `TourLibrary` Landing;
  `view` only picks the visible pane on phone — see Responsive Landing above)
- `#stop=<stopId>&route=<routeId>` → `view = 'stop'`

Navigation functions (`goLibrary`, `goRoute`, `goStop`, `goStopById`, `selectRoute`) update both the `$state` and `window.location.hash` together. A `hashchange` listener handles browser back/forward.

### Svelte 5 runes — key pitfalls

This codebase uses Svelte 5 runes throughout (`$state`, `$derived`, `$effect`, `$props`). The critical rule: **an `$effect` must not read and write the same piece of state** — Svelte will throw `effect_update_depth_exceeded` and the scheduler will wedge (clicks update state but DOM never re-renders). Use `SvelteSet`/`SvelteMap` from `svelte/reactivity` when you need a reactive collection that mutates in place.

### Stores

Svelte 4 stores coexist with runes (bridged via `writable` + `$effect`):
- `src/lib/geo/store.ts` — `geolocation` (writable, browser Geolocation API) + `createProximityStore` (derived, Haversine distances to all stops). The GPS watch is subscriber-scoped: it starts on first subscribe and `clearWatch` fires on last unsubscribe (writable start/stop notifier). **Accuracy is mode-switched** (`setGeoAccuracyMode('low'|'high')`, default low): App.svelte sets low on the library view (km-scale tour sorting doesn't need GNSS — battery) and high once a tour is open (walker locator + 30m stop proximity); a mode change restarts a running watch with the new `enableHighAccuracy`. The proximity store takes a `Readable<TourStop[]>` plus an optional injectable geo store (for tests) so it reacts to both GPS updates and route changes.
- `src/lib/theme/store.ts` — `theme` store (light/dark/night). Persists to `localStorage` under `fw-theme` only on explicit user choice; until then it follows system `prefers-color-scheme` changes live. Applies `data-theme` attribute to `<html>` and updates the `theme-color` meta tag. Cycle order: light → dark → night → light.
- `src/lib/offline/store.ts` — `online` (readable, `navigator.onLine` + events) plus the offline warm-up helpers: `isBasemapCached`/`cacheBasemap` (pmtiles full-file GET), and the full-tour layer `isTourCached`/`cacheTourOffline`/`tourOfflineBytes`/`fmtBytes` driven by each route's build-time `OfflineManifest`. Drives the "Save tour offline" button on the route overview, the "Save all tours offline" row in the library rail, and the per-tour offline badges.

### Theming

Three CSS custom-property blocks keyed on `[data-theme="light|dark|night"]` live in `src/styles/brand.css` — the single file authors edit to rebrand. `src/app.css` contains structural CSS only (reset, keyframes, utility classes) and must not contain token values. Import order in `main.ts`: `brand.css` before `app.css`.

**Map recolouring (design handoff "Night Map Filter"):** one map asset serves
all three modes. The per-theme `--map-canvas-filter` token (none / dark dip /
night sepia→saturate→hue-rotate chain) is applied by `app.css` to
`.map-canvas .maplibregl-canvas` **only** — the WebGL tile canvas. Markers,
popups and the attribution control are canvas *siblings* inside MapLibre's
canvas container and must stay unfiltered so their per-theme colours read
crisp. **Night must stay the pure-CSS filter chain** — the handoff's
feColorMatrix `url(#…)` variant silently no-ops on WebKit (long-standing
Safari bugs applying SVG-referenced filters to composited, continuously
painting elements like the map canvas), so it broke on iPhones; do not
"upgrade" it back. Transition: `filter .45s ease`. The SVG schematic fallback
is already tokened per theme and takes no filter.

### PWA / service worker

`vite-plugin-pwa` (Workbox) generates `sw.js` + `manifest.webmanifest` **only at build**. There is no service worker in `npm run dev` (the `devOptions` line in `vite.config.ts` is intentionally commented out). To test offline behaviour, use `npm run build && npm run preview`.

Workbox strategy (defined in `src/lib/pwa/workbox-config.ts`, shared with the runtime offline helpers so cache names cannot drift): app shell + latin web fonts are precached; `globIgnores: ['tours/**']` keeps tour media out of the precache. `.pmtiles` basemaps use a **runtime** `CacheFirst` rule with `rangeRequests: true` (Workbox `RangeRequestsPlugin`) in a dedicated `pmtiles-basemaps` cache. Other `/tours/…` media is runtime-cached with `CacheFirst` (60-day TTL, 200-entry cap).

**PMTiles offline requires an explicit warm-up.** pmtiles always fetches with `Range:` headers, and the Cache API cannot store the resulting 206 responses — so the runtime rule alone never fills the cache. `cacheBasemap()` (`src/lib/offline/store.ts`) does a full-file GET (`cache.add`) storing a 200 response; the `RangeRequestsPlugin` then serves 206 slices from it offline. Do not "simplify" this back to passive runtime caching — it silently breaks offline maps.

**Full-tour offline saves (explicit, user-triggered).** Each route carries a build-time `OfflineManifest` (`route.offline`, built in `vite-plugin.ts`): the effective URL of every media file the tour references (the `.webp` variant when one exists — that is what `<picture>`-aware browsers fetch) plus statted byte sizes, so the save buttons show real numbers with no runtime HEAD requests. Files missing at build time are omitted (warming never 404s in an unseeded dev tree). `cacheTourOffline()` warms manifest media into `tour-media` and the basemap via `cacheBasemap()`; `isTourCached()` gates the ✓ states and library badges. UI: the route-overview footer button ("Save tour offline · ~12 MB", `RouteMap.svelte`) and the library rail's "Save all tours offline · ~N MB" row (`TourLibrary.svelte`). Caveat: entries inserted outside Workbox get no ExpirationPlugin timestamp until first SW serve; and `tour-media`'s `maxEntries: 200` is fine for 3 tours but a large saved catalogue could start evicting itself (future: raise the cap or per-tour caches).

**Stale SW hazard:** if the deployed origin or base path changes, browsers with a cached SW will be stranded and show a white screen (the SW intercepts requests for the old paths). Fix: DevTools → Application → Service Workers → Unregister → Storage → Clear site data → hard reload. On iOS: Settings → Safari → Advanced → Website Data → delete the site entry.

### Base-path aware builds

`vite.config.ts` reads `base` from the `BASE_PATH` env var (default `/`). The content plugin (`src/lib/content/vite-plugin.ts`) captures this in a `configResolved` hook and rewrites all content media hrefs (`hero.src`, inline markdown `src`/`data-src`, and `map.basemap` from `tour.yaml`) via `withBase()` at build time. Authors always write `/tours/…` paths — the plugin prefixes them for the target host. For sub-path hosts: `BASE_PATH=/myapp/ npm run build`.

### Deployment

Live at **https://tour.field.works** — GitHub Pages with a custom domain.

Auto-deploys on push to `main` via `.github/workflows/deploy.yml`:
1. `actions/configure-pages` — enforces GitHub Actions as the Pages source (prevents branch-serve fallback that would expose raw TS files and show a white screen).
2. `npm run check && npm run test` — the deploy fails if types or tests fail.
3. `npm run demo:seed && npm run build` — seeds demo media then builds with default base `/`.
4. Uploads `dist/` and deploys.

**`public/CNAME`** (contains `tour.field.works`) must not be deleted — GitHub Pages reads this on each deploy to configure the custom domain. It gets copied into `dist/` automatically because it is in `public/`.

### Media assets

Real tour media goes in `public/tours/<route-id>/` and is committed to the repo. The demo tours' media (`public/tours/cissbury-ring/`, `public/tours/wolstonbury-hill/`, and `public/tours/mount-caburn/`) is gitignored and generated by `npm run demo:seed` (see `scripts/seed-demo.mjs` — zero-dependency Node ESM with a per-route `ROUTES` spec table, produces PNG/MP3/MP4/GLB). The exceptions are the real committed basemaps, un-ignored in `.gitignore`: `cissbury-ring/cissbury.pmtiles`, `wolstonbury-hill/wolstonbury.pmtiles`, and `mount-caburn/caburn.pmtiles`. Generated `.webp` variants (`scripts/optimize-media.mjs`, part of `npm run build`) are never committed — `/public/tours/**/*.webp` is gitignored.

### Tests

Run with vitest (`svelteTesting()` in `vitest.config.ts` makes Svelte 5 component mounting work under jsdom):
- `src/lib/geo/store.test.ts` — Haversine, `isNearby`, `createProximityStore` (with injected geo store), GPS watch start/stop lifecycle
- `src/lib/router.test.ts` — `parseHash`/`buildHash` round-trips and edge cases
- `src/lib/content/content.test.ts` — integration tests that read the real `content/` directory: validates `tour.yaml` structure, stop file resolution (including numbered-prefix convention), required frontmatter fields, and `map.basemap` field format
- `src/lib/content/media.test.ts` — `withBase`, `escapeHtml`, and the media renderer (`.mp3` → audio, `.mp4` → video, `.glb` → model stub, attribute escaping)
- `src/lib/map/style.test.ts` — `buildMapStyle` (pmtiles-only shape; merged: base sources + tour raster layer last, sprite/glyphs preserved, attribution added, input never mutated), `mapZoomRange`, and the `isFatalMapError` contract (uses a small fixture base style, not the real 41 KB JSON)
- `src/lib/map/markers.test.ts` — the map-marker DOM builders: numbered stop pin (aria-label, HTML number overlay, title escaping), walker locator heading rotation/hiding, popup eyebrow distance formatting and in-place updates. The live map wiring (marker anchors, popup open/close, locator following the fix) is verified manually in the browser — jsdom has no WebGL.
- `src/lib/media/models.test.ts` — `hydrateModels` with an injected fake loader: no import when no stub, stub → `<model-viewer>` upgrade, loader-failure fallback, idempotence, retry after failure. **Never put `.media-model` HTML in component-test fixtures** — that would trigger the real `@google/model-viewer` import under jsdom.
- `src/lib/pwa/workbox-config.test.ts` — guards the SW rules (tour media excluded from precache, pmtiles rule is Range-aware CacheFirst)
- `src/lib/TourStop.test.ts`, `src/lib/TourLibrary.test.ts`, `src/lib/RouteMap.test.ts` — component tests (@testing-library/svelte): proximity footer states incl. stale-fix handling, nav edges, SVG map fallback, the wordmark home button, and the responsive one-DOM layouts. For the Landing: rail (`.tour-list`) + overview (`.tour-overview`) present together, `data-phone-view` follows the `view` prop, selected-vs-idle card `data-state`. For RouteMap-as-overview: `.start-tour[data-tour]` hook + Start/Resume CTA text and the `.tour-overview[data-tour]` root. For TourStop: the phone hero `MapPanel` and the rail `MapPanel` both mount with distinct `id`s (`tour-map-hero` / `tour-map`) and accessible names, since jsdom has no WebGL so both fall back to the SVG schematic — the live map, its markers (current-stop pin, user-location dot), and the recentring behaviour are verified manually in the browser instead. TourStop also covers the lightbox (open from body image and hero button, close via Escape/button/backdrop, image click does not close).

Expected baseline: **160 tests pass, 0 errors** from `npm run check`.
