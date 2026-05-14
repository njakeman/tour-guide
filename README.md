# Tour Guide PWA

An offline-first progressive web app for delivering location-aware walking tours. Designed for archaeological sites, historic landscapes, and heritage trails.

## Features

- **Offline-first**: All content and media bundled into the PWA — works without mobile signal
- **Markdown content**: Tour stops written as individual `.md` files with YAML frontmatter
- **Geolocation-aware**: Highlights nearest stop via GPS with proximity detection
- **Manual fallback**: Sequential navigation with back/forward button support when GPS is unavailable
- **Rich media**: Support for images, audio narration, video, and 3D models per stop
- **Multiple routes**: Each tour is a separate route; stops can be shared across routes
- **URL routing**: Hash-based URLs (`#stop=stop-id`) enable bookmarking and browser history

## Architecture

```
content/                          # Tour content (markdown + YAML)
├── routes/
│   └── cissbury-ring/            # One directory per tour route
│       ├── tour.yaml             # Route manifest: name, description, icon, stops list
│       └── stops/                # Individual stop markdown files
│           ├── cissbury-entrance.md
│           └── cissbury-summit.md
└── shared/
    └── stops/                    # Reusable stops across routes

public/                           # Static assets (icons, media precached by SW)
src/
├── lib/
│   ├── content/
│   │   └── vite-plugin.ts        # Vite plugin: loads markdown as typed JSON at build time
│   ├── geo/
│   │   └── store.ts              # Svelte geolocation store with Haversine distance
│   ├── TourStop.svelte           # Stop renderer: markdown body, evidence, interpretation, media
│   └── TourNav.svelte            # Sequential prev/next navigation
├── App.svelte                    # Root: route selector, geolocation status, proximity UI
└── main.ts                       # PWA service worker registration

vite.config.ts                    # Vite + content plugin + PWA generation
vitest.config.ts                  # Test config (Vitest, node environment)
```

## Quick Start

Requires **Node.js 20+** (tested on v22 LTS).

```bash
# Install dependencies
npm install

# Start development server with hot reload
npm run dev

# Run unit tests
npm test

# Type check
npm run check

# Production build (generates PWA assets in dist/)
npm run build

# Preview production build locally
npm run preview
```

## Content Authoring Guide

### 1. Create a new route

Create a directory under `content/routes/<route-id>/` with:

- `tour.yaml` — route manifest
- `stops/` — individual stop `.md` files

#### tour.yaml

```yaml
route_name: "Cissbury Ring"
description: "A walking tour of the Iron Age hillfort."
icon: "🪨"
stops:
  - "cissbury-entrance"
  - "cissbury-summit"
```

The `stops` list references stop files by ID (without `.md` extension). The build system looks for:
1. `content/routes/cissbury-ring/stops/<id>.md`
2. `content/shared/stops/<id>.md` (for reusable stops)

### 2. Write a stop

Each stop is a markdown file with YAML frontmatter:

```markdown
---
id: cissbury-entrance
title: "Cissbury Ring: Approach and Enclosure"
lat: 50.8561
lng: -0.3790
proximity_radius: 50
media:
  - type: image
    src: "/tours/cissbury-ring/entrance.jpg"
    caption: "The defensive bank and ditch on approach"
  - type: audio
    src: "/tours/cissbury-ring/narration.mp3"
    caption: "Expert narration by Dr. Smith"
evidence: |
  Visible earthworks define a substantial enclosure on the hilltop.
interpretation: |
  The scale and prominence may have supported gatherings, signalling, or socially meaningful movement.
---

# Approach and Enclosure

You are now approaching Cissbury Ring, one of the largest hillforts in Sussex...

## Look Out For

- The double bank-and-ditch on the southern approach
- Flint mining pits from earlier Neolithic activity

> "Hillforts are not just defensive structures—they are statements of community."

Continue along the path to reach the main enclosure.
```

#### Frontmatter fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique stop identifier |
| `title` | string | Yes | Display title |
| `lat` | number | No | Latitude for geolocation |
| `lng` | number | No | Longitude for geolocation |
| `proximity_radius` | number | No | "Nearby" threshold in metres (default: 30) |
| `media` | array | No | List of media objects |
| `evidence` | string | No | Click-to-reveal archaeological evidence |
| `interpretation` | string | No | Click-to-reveal expert interpretation |

#### Media types

```yaml
media:
  - type: image
    src: "/tours/cissbury-ring/photo.jpg"
    caption: "View from the entrance"
  - type: audio
    src: "/tours/cissbury-ring/narration.mp3"
    caption: "Audio commentary"
  - type: video
    src: "/tours/cissbury-ring/drone.mp4"
    caption: "Drone footage"
  - type: model
    src: "/tours/cissbury-ring/fort.glb"
    caption: "3D reconstruction"
```

**Important**: Media files under `public/tours/` are automatically included in the PWA precache manifest and will be available offline.

### 3. Add media files

Place images, audio, video, and 3D models in the `public/tours/<route>/` directory:

```
public/
└── tours/
    └── cissbury-ring/
        ├── entrance.jpg
        ├── narration.mp3
        └── fort.glb
```

### 4. Build and test

```bash
npm run build    # Compiles markdown → JSON, bundles media into PWA
npm run preview  # Verify offline mode works
```

## Deployment

The app builds into a static `dist/` directory suitable for any static hosting (GitHub Pages, Netlify, Vercel, S3, etc.).

### GitHub Pages

1. Build the project: `npm run build`
2. Copy `dist/` to a `gh-pages` branch, or use GitHub Actions to auto-deploy on push
3. Ensure `index.html` is at the root of the Pages site

### Service Worker Lifecycle

The PWA uses `vite-plugin-pwa` with Workbox:
- **Precache**: All build assets (JS, CSS, HTML, manifest, tour media) cached on first install
- **Runtime**: Navigation requests fall back to `index.html` (SPA behaviour)
- **Updates**: New deployments trigger service worker update notification; users see new content on page reload

## Testing

```bash
# Run all tests
npm test

# Watch mode during development
npx vitest

# Type checking
npm run check
```

### Test coverage

| Test file | What it tests |
|-----------|---------------|
| `src/lib/geo/store.test.ts` | Haversine distance calculations (accuracy, edge cases) |
| `src/lib/content/content.test.ts` | Content pipeline integrity (YAML manifests, markdown parsing, file resolution) |

To add component tests, create `<Component>.test.ts` alongside the component. See `@testing-library/svelte` for DOM testing utilities.

## Adding a New Tour

1. **Copy the Cissbury Ring template**:
   ```bash
   cp -r content/routes/cissbury-ring content/routes/my-new-tour
   ```

2. **Edit `tour.yaml`**:
   ```yaml
   route_name: "My New Tour"
   description: "Description here."
   icon: "🏛️"
   stops:
     - "stop-01"
     - "stop-02"
   ```

3. **Create stop files** in `content/routes/my-new-tour/stops/` matching the IDs in the YAML.

4. **Add media** to `public/tours/my-new-tour/`

5. **Build and test**:
   ```bash
   npm run build
   npm run preview
   ```

The app currently defaults to the first route (`routes[0]`). Multi-route selection UI is on the roadmap.

## Roadmap

- [x] Markdown content pipeline
- [x] Geolocation with proximity highlighting
- [x] Media support (image, audio, video, 3D model)
- [x] Offline PWA with service worker
- [x] Unit tests for core utilities
- [ ] Multi-route selector UI
- [ ] Tour progress persistence (localStorage)
- [ ] 3D model viewer integration (Three.js / Model-Viewer)
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] i18n support for multi-language tours

## License

MIT
