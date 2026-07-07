# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # dev server at http://localhost:5173 (no service worker)
npm run demo:seed    # generate placeholder media into public/tours/cissbury-ring/ (gitignored)
npm run demo         # demo:seed + dev in one command
npm run check        # svelte-check + tsc (run before committing)
npm run test         # vitest run (single pass)
npx vitest           # vitest watch mode
npm run build        # production build → dist/
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

Markdown image syntax is intercepted at build time: `![caption](file.ext)` is rendered to different HTML elements depending on extension (`.mp3` → `<audio>`, `.mp4` → `<video>`, `.glb` → `.media-model` div, images → `<figure><img>`). This happens in `vite-plugin.ts:22-44`.

Stop files can live at `stops/<id>.md` or with a numbered prefix `stops/01-<id>.md`. The `id:` frontmatter field must match the entry in `tour.yaml`.

### Responsive stop screen (design handoff: "Tour Responsive Proof")

`src/lib/TourStop.svelte` is **one component tree for every width** — a single
`720px` viewport breakpoint decides the layout; nothing is added or removed
between sizes:

- **< 720px (phone)** — paginated: the stop detail is primary; the map and the
  stop list live behind the bottom tab bar (`Stop / Map & route / Stops`,
  `.ts-tab[data-view]`, local `phoneView` state). Accordions stack vertically.
- **≥ 720px (tablet landscape)** — master–detail: a persistent 400px left rail
  (`.ts-rail`) holds the map + stop list; the detail fills the right; the tab
  bar is hidden; Evidence/Interpretation sit side by side; title 32→42px,
  hero 196→256px.

Shared pieces: `src/lib/MapPanel.svelte` (map + SVG fallback, used by RouteMap
and the TourStop rail; mounts at `#tour-map`) and `src/lib/StopList.svelte`
(progress rows, `.stop-list__item[data-state]`). **CSS ordering matters:** the
two `@media` blocks in TourStop.svelte must stay AFTER the base rules — they
override properties (display/font-size/height) at equal specificity, so source
order decides.

### Responsive Landing (design handoff: tablet master–detail)

`src/lib/TourLibrary.svelte` is the **Landing shell** and applies the same
one-DOM / single-720px-breakpoint model as the stop screen. It owns the status
bar + shared app header (wordmark, "Field guide" eyebrow, `ThemeToggle`) and a
`.tl-body[data-phone-view]` split into `.tl-rail` (the card list — "Tours"
title, filters, `.tour-list` of `.tour-card[data-tour][data-state]`) and
`.tl-overview` (which renders `src/lib/RouteMap.svelte`).

- **< 720px (phone)** — paginated: `data-phone-view` (driven by App's `view`,
  `'library' | 'route'`) shows the rail OR the overview. Tapping a card calls
  `onSelect` → `selectRoute` (`#/route`); the overview's phone-only `.nav-back`
  chip returns to the list.
- **≥ 720px (tablet landscape)** — master–detail: 472px rail + overview both
  visible; the phone's standalone Route page is **folded into the overview**, so
  there is no separate Route view at tablet width. The back chip is hidden.

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
`display:none` (e.g. the phone hero map at ≥720px, see below) never
instantiates MapLibre at all — no wasted WebGL context.

- `maplibre-gl` and `pmtiles` are **dynamically imported** inside `onMount` so
  the app shell stays small (~80 KB main chunk vs ~1.1 MB with a static import).
  The maplibre chunk is still precached by the SW, so it works offline.
- The PMTiles protocol is registered via the `pmtiles` npm package
  (`Protocol.tile`) and cleaned up on component teardown.
- Falls back to the inline SVG schematic when there is no basemap, WebGL is
  unavailable, MapLibre throws on init, **or an async `map.on('error')` fires
  before first render** (basemap 404, offline with a cold cache). The SVG also
  doubles as the loading state until the map's `load` event.
- `minZoom 11 / maxZoom 17` — clamp to the tileset range to avoid blank tiles.
- Use `onMount` (not `$effect`) for map lifecycle to avoid `effect_update_depth_exceeded`.
- **Debugging gotcha:** MapLibre renders via requestAnimationFrame. In an
  occluded/hidden Chrome window, rAF is frozen, so the `load` event never
  fires and the SVG loading state persists — that is browser throttling, not
  a bug. It resolves the moment the window becomes visible.

**Overrides (`center`, `zoom`, `label`, `showUserLocation`, `markCurrentStop`, `id`):**
all optional, all default to the original route-level behaviour, so every
existing call site is unaffected. This lets one `MapPanel` serve three roles:
the TourStop rail map, the RouteMap overview, and the phone stop-hero (below).
`label` overrides the default `"Route map for {route.name}"` aria-label —
required whenever two MapPanels are mounted at once so accessible names (and
the `id` prop, default `tour-map`) don't collide.

**Live-location dot:** when `showUserLocation` (default `true`), MapPanel
subscribes to the `geolocation` store (`src/lib/geo/store.ts`) and renders the
GPS fix as a MapLibre HTML `Marker` (`.user-loc-marker`, styled in `app.css`,
reusing the `tg-pulse` keyframe and the `--user-dot` brand token) — hidden
until the first fix, then `marker.setLngLat()` on every update. **The map is
never recentred on it** — the offline PMTiles cache only covers a fixed area,
so the viewport must stay under the user's control; panning away from the dot
is expected and does not snap back. `markCurrentStop` drops one static pin
(`--pin-current`) at the given stop's coordinates, used only by the hero map.

**Phone stop-hero (`TourStop.svelte`):** on phone (<720px) the stop's hero
plate is a live `MapPanel` centred on the current stop (`center`, `zoom={16}`,
`markCurrentStop`) instead of the photo — useful for orientation mid-walk. On
tablet (≥720px) the hero shows the photo as before, since the rail map is
already permanently visible; the hero `MapPanel` stays `display:none` there
and so never initialises. Both blocks exist in the DOM at every width (`.plate
stop-hero` renders `.hero-map` unconditionally when the stop has coordinates,
alongside the existing `<img>`/SVG); the `@media` blocks at the end of
`TourStop.svelte`'s `<style>` toggle which one is visible.
- Stop markers + a route line drawn directly on the real MapLibre map (rather
  than only in the SVG fallback) remain a future Phase 2 item.

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
- `src/lib/geo/store.ts` — `geolocation` (writable, browser Geolocation API) + `createProximityStore` (derived, Haversine distances to all stops). The GPS watch is subscriber-scoped: it starts on first subscribe and `clearWatch` fires on last unsubscribe (writable start/stop notifier). The proximity store takes a `Readable<TourStop[]>` plus an optional injectable geo store (for tests) so it reacts to both GPS updates and route changes.
- `src/lib/theme/store.ts` — `theme` store (light/dark/night). Persists to `localStorage` under `fw-theme` only on explicit user choice; until then it follows system `prefers-color-scheme` changes live. Applies `data-theme` attribute to `<html>` and updates the `theme-color` meta tag. Cycle order: light → dark → night → light.
- `src/lib/offline/store.ts` — `online` (readable, `navigator.onLine` + events) and the pmtiles cache helpers: `isBasemapCached`, `cacheBasemap` (full-file warm-up GET), `basemapSize` (HEAD). Drives the "save map offline" button on the route view and the real per-tour offline badges / "Saved" filter in the library.

### Theming

Three CSS custom-property blocks keyed on `[data-theme="light|dark|night"]` live in `src/styles/brand.css` — the single file authors edit to rebrand. `src/app.css` contains structural CSS only (reset, keyframes, utility classes) and must not contain token values. Import order in `main.ts`: `brand.css` before `app.css`.

### PWA / service worker

`vite-plugin-pwa` (Workbox) generates `sw.js` + `manifest.webmanifest` **only at build**. There is no service worker in `npm run dev` (the `devOptions` line in `vite.config.ts` is intentionally commented out). To test offline behaviour, use `npm run build && npm run preview`.

Workbox strategy (defined in `src/lib/pwa/workbox-config.ts`, shared with the runtime offline helpers so cache names cannot drift): app shell + latin web fonts are precached; `globIgnores: ['tours/**']` keeps tour media out of the precache. `.pmtiles` basemaps use a **runtime** `CacheFirst` rule with `rangeRequests: true` (Workbox `RangeRequestsPlugin`) in a dedicated `pmtiles-basemaps` cache. Other `/tours/…` media is runtime-cached with `CacheFirst` (60-day TTL, 200-entry cap).

**PMTiles offline requires an explicit warm-up.** pmtiles always fetches with `Range:` headers, and the Cache API cannot store the resulting 206 responses — so the runtime rule alone never fills the cache. The "save map offline" button on the route view calls `cacheBasemap()` (`src/lib/offline/store.ts`), which does a full-file GET (`cache.add`) storing a 200 response; the `RangeRequestsPlugin` then serves 206 slices from it offline. Do not "simplify" this back to passive runtime caching — it silently breaks offline maps.

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

Real tour media goes in `public/tours/<route-id>/` and is committed to the repo. The demo tour's media (`public/tours/cissbury-ring/`) is gitignored and generated by `npm run demo:seed` (see `scripts/seed-demo.mjs` — zero-dependency Node ESM, produces PNG/MP3/MP4/GLB). The exception is `cissbury-tiles-v2.pmtiles` — this is a committed real asset un-ignored in `.gitignore`.

### Tests

Run with vitest (`svelteTesting()` in `vitest.config.ts` makes Svelte 5 component mounting work under jsdom):
- `src/lib/geo/store.test.ts` — Haversine, `isNearby`, `createProximityStore` (with injected geo store), GPS watch start/stop lifecycle
- `src/lib/router.test.ts` — `parseHash`/`buildHash` round-trips and edge cases
- `src/lib/content/content.test.ts` — integration tests that read the real `content/` directory: validates `tour.yaml` structure, stop file resolution (including numbered-prefix convention), required frontmatter fields, and `map.basemap` field format
- `src/lib/content/media.test.ts` — `withBase`, `escapeHtml`, and the media renderer (`.mp3` → audio, `.mp4` → video, `.glb` → model stub, attribute escaping)
- `src/lib/pwa/workbox-config.test.ts` — guards the SW rules (tour media excluded from precache, pmtiles rule is Range-aware CacheFirst)
- `src/lib/TourStop.test.ts`, `src/lib/TourLibrary.test.ts`, `src/lib/RouteMap.test.ts` — component tests (@testing-library/svelte): proximity footer states incl. stale-fix handling, nav edges, SVG map fallback, saved-filter empty state, and the responsive one-DOM layouts. For the Landing: rail (`.tour-list`) + overview (`.tour-overview`) present together, `data-phone-view` follows the `view` prop, selected-vs-idle card `data-state`. For RouteMap-as-overview: `.start-tour[data-tour]` hook + Start/Resume CTA text and the `.tour-overview[data-tour]` root. For TourStop: the phone hero `MapPanel` and the rail `MapPanel` both mount with distinct `id`s (`tour-map-hero` / `tour-map`) and accessible names, since jsdom has no WebGL so both fall back to the SVG schematic — the live map, its markers (current-stop pin, user-location dot), and the recentring behaviour are verified manually in the browser instead.

Expected baseline: **74 tests pass, 0 errors** from `npm run check`.
