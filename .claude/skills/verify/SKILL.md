---
name: verify
description: Build and drive the tour-guide PWA end-to-end (headless Chrome via puppeteer-core) to verify map/PWA behaviour at the real surface.
---

# Verifying tour-guide changes

## Build + serve

```powershell
npm run build          # demo media must exist first: npm run demo:seed (once)
npm run preview        # http://localhost:4173 — the only way to test the SW
```

## Driving the app

The Claude-in-Chrome MCP window can be minimised/hidden (viewport 0×0,
`visibilityState: hidden`) — MapLibre's rAF freezes there and the map never
fires `render`/`load`, so browser-MCP verification silently stalls. Reliable
alternative: **headless installed Chrome via puppeteer-core** (no browser
download):

```powershell
cd <scratchpad>; npm i puppeteer-core --no-save
```

- `executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'`
- `headless: 'new'`, args `['--use-angle=swiftshader', '--enable-unsafe-swiftshader']`
  — WebGL works, MapLibre renders, screenshots capture real pixels.
- Phone layout: viewport width < 720 (e.g. 560×900). Tap `.tour-card` →
  route overview with `.tour-overview .map-panel`.

## Map DOM signals (MapPanel.svelte)

- `svg.map-svg` present → loading state (or fallback); gone → map revealed.
- `.map-canvas` div absent → `mapFailed` (SVG is the permanent fallback).
- `canvas.maplibregl-canvas` → MapLibre initialised.
- `.stop-marker` count / `.walker-locator` → reveal() ran (markers are wired
  at reveal, not `load`).
- `.maplibregl-ctrl-attrib.maplibregl-compact-show` → attribution expanded
  (should be absent after reveal).

## Simulating network failure modes

Patch `window.fetch` in `page.evaluateOnNewDocument` (before app code runs):
- **Hang** (the iOS symptom): return `new Promise(() => {})` for URLs
  containing `tiles.openfreemap.org`. Sprite/TileJSON/glyph requests are
  main-thread, so this wedges MapLibre's `load` for real. Map must still
  reveal via the basemap `sourcedata` path.
- **Fail fast**: `Promise.reject(new TypeError(...))` — exercises the
  fail-open (`isFatalMapError`) path.
- **Broken basemap**: reject URLs containing `.pmtiles` — must keep the SVG
  fallback (fatal path).

A ready-made script pattern lives in the session scratchpad as
`verify-map.mjs` (scenarios: happy / ofm-hang / pmtiles-broken); recreate it
from this recipe if gone.
