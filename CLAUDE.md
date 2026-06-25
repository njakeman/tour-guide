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

### Map — MapLibre GL + PMTiles (Phase 1)

`src/lib/RouteMap.svelte` renders a **MapLibre GL** map when `route.map.basemap`
is set in the tour manifest. The basemap is a local PMTiles raster file
(`public/tours/<id>/*.pmtiles`) — no tile server, no network required at runtime.

- The PMTiles protocol is registered via the `pmtiles` npm package
  (`Protocol.tile`) and cleaned up on component teardown.
- Falls back to the inline SVG schematic when there is no basemap, WebGL is
  unavailable, or MapLibre throws on init.
- `minZoom 11 / maxZoom 17` — clamp to the tileset range to avoid blank tiles.
- Use `onMount` (not `$effect`) for map lifecycle to avoid `effect_update_depth_exceeded`.
- Phase 2 will add stop markers, a route line, and live-location dot.

The `map:` field in `tour.yaml` (optional) carries `basemap`, `center` ([lng,lat]), and `zoom`.
The content plugin rewrites `map.basemap` through `withBase()` at build time.

### Routing

Hash-based, no router library. `App.svelte` owns all routing state as Svelte 5 `$state` runes:
- `#/` → `view = 'library'`
- `#/route` → `view = 'route'`
- `#stop=<stopId>&route=<routeId>` → `view = 'stop'`

Navigation functions (`goLibrary`, `goRoute`, `goStop`, `goStopById`, `selectRoute`) update both the `$state` and `window.location.hash` together. A `hashchange` listener handles browser back/forward.

### Svelte 5 runes — key pitfalls

This codebase uses Svelte 5 runes throughout (`$state`, `$derived`, `$effect`, `$props`). The critical rule: **an `$effect` must not read and write the same piece of state** — Svelte will throw `effect_update_depth_exceeded` and the scheduler will wedge (clicks update state but DOM never re-renders). Use `SvelteSet`/`SvelteMap` from `svelte/reactivity` when you need a reactive collection that mutates in place.

### Stores

Two Svelte 4 stores coexist with runes (bridged via `writable` + `$effect`):
- `src/lib/geo/store.ts` — `geolocation` (writable, browser Geolocation API) + `createProximityStore` (derived, Haversine distances to all stops). The proximity store takes a `Readable<TourStop[]>` so it reacts to both GPS updates and route changes.
- `src/lib/theme/store.ts` — `theme` store (light/dark/night). Persists to `localStorage` under `fw-theme`; applies `data-theme` attribute to `<html>` and updates the `theme-color` meta tag. Cycle order: light → dark → night → light.

### Theming

Three CSS custom-property blocks keyed on `[data-theme="light|dark|night"]` live in `src/styles/brand.css` — the single file authors edit to rebrand. `src/app.css` contains structural CSS only (reset, keyframes, utility classes) and must not contain token values. Import order in `main.ts`: `brand.css` before `app.css`.

### PWA / service worker

`vite-plugin-pwa` (Workbox) generates `sw.js` + `manifest.webmanifest` **only at build**. There is no service worker in `npm run dev` (the `devOptions` line in `vite.config.ts` is intentionally commented out). To test offline behaviour, use `npm run build && npm run preview`.

Workbox strategy: app shell + web fonts are precached. `.pmtiles` basemaps use a **runtime** `CacheFirst` rule with `rangeRequests: true` (Workbox `RangeRequestsPlugin`) in a dedicated `pmtiles-basemaps` cache — precaching would store a full 200 response, which pmtiles rejects when it issues HTTP Range requests (it throws on status 200 + full body). Other `/tours/…` media is runtime-cached with `CacheFirst` (60-day TTL, 200-entry cap). Offline map rendering works after one online visit to the route overview (which triggers all visible tile loads).

**Stale SW hazard:** if the deployed origin or base path changes, browsers with a cached SW will be stranded and show a white screen (the SW intercepts requests for the old paths). Fix: DevTools → Application → Service Workers → Unregister → Storage → Clear site data → hard reload. On iOS: Settings → Safari → Advanced → Website Data → delete the site entry.

### Base-path aware builds

`vite.config.ts` reads `base` from the `BASE_PATH` env var (default `/`). The content plugin (`src/lib/content/vite-plugin.ts`) captures this in a `configResolved` hook and rewrites all content media hrefs (`hero.src`, inline markdown `src`/`data-src`, and `map.basemap` from `tour.yaml`) via `withBase()` at build time. Authors always write `/tours/…` paths — the plugin prefixes them for the target host. For sub-path hosts: `BASE_PATH=/myapp/ npm run build`.

### Deployment

Live at **https://tour.field.works** — GitHub Pages with a custom domain.

Auto-deploys on push to `main` via `.github/workflows/deploy.yml`:
1. `actions/configure-pages` — enforces GitHub Actions as the Pages source (prevents branch-serve fallback that would expose raw TS files and show a white screen).
2. `npm run demo:seed && npm run build` — seeds demo media then builds with default base `/`.
3. Uploads `dist/` and deploys.

**`public/CNAME`** (contains `tour.field.works`) must not be deleted — GitHub Pages reads this on each deploy to configure the custom domain. It gets copied into `dist/` automatically because it is in `public/`.

### Media assets

Real tour media goes in `public/tours/<route-id>/` and is committed to the repo. The demo tour's media (`public/tours/cissbury-ring/`) is gitignored and generated by `npm run demo:seed` (see `scripts/seed-demo.mjs` — zero-dependency Node ESM, produces PNG/MP3/MP4/GLB). The exception is `cissbury-tiles-v2.pmtiles` — this is a committed real asset un-ignored in `.gitignore`.

### Tests

Two test files, both run with vitest:
- `src/lib/geo/store.test.ts` — pure function unit tests (Haversine, `isNearby`, `createProximityStore`)
- `src/lib/content/content.test.ts` — integration tests that read the real `content/` directory: validates `tour.yaml` structure, stop file resolution (including numbered-prefix convention), required frontmatter fields, and `map.basemap` field format

Expected baseline: **15 tests pass, 0 errors** from `npm run check`.
