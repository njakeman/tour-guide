# fieldWorks

An offline-first PWA for handheld walking tours — hillforts, henges, barrows, and heritage trails. Tours are authored in Markdown, work without a network connection once installed, and install directly to an iOS or Android home screen.

Built with Svelte 5 · Vite 7 · vite-plugin-pwa / Workbox · three-way Light / Dark / Night theming.

---

## Quick start

Requires **Node.js 20+**.

```bash
npm install        # install dependencies
npm run dev        # dev server at http://localhost:5173
npm test           # run unit tests (vitest)
npm run check      # type-check (svelte-check + tsc)
npm run build      # production build → dist/
npm run preview    # serve dist/ locally to test PWA
```

---

## Project structure

```
content/                      # Tour content — edit this to add tours
├── routes/
│   └── cissbury-ring/
│       ├── tour.yaml         # Route manifest
│       └── stops/
│           ├── cissbury-entrance.md
│           └── cissbury-summit.md

public/                       # Static assets served as-is
└── tours/
    └── cissbury-ring/        # Media for each route
        ├── entrance.jpg
        └── narration.mp3

src/
├── lib/
│   ├── content/
│   │   └── vite-plugin.ts    # Build-time content pipeline
│   ├── geo/
│   │   └── store.ts          # Geolocation + Haversine proximity
│   ├── theme/
│   │   └── store.ts          # Light / Dark / Night theme store
│   ├── media/
│   │   └── ModelViewer.svelte
│   ├── types.ts              # Shared TypeScript types
│   ├── TourLibrary.svelte    # Home screen — tour cards
│   ├── RouteMap.svelte       # Route overview — inline SVG map
│   ├── TourStop.svelte       # Stop screen — content + media + proximity
│   ├── HengeLogo.svelte      # Brand mark
│   └── ThemeToggle.svelte    # Light → Dark → Night toggle
├── App.svelte                # Hash router
└── main.ts                   # Entry point + PWA registration

vite.config.ts                # Vite + content plugin + PWA config
```

---

## Authoring a tour

### 1 · Create the route folder

```
content/routes/<route-id>/
    tour.yaml
    stops/
        01-first-stop.md
        02-second-stop.md
```

The folder name (`<route-id>`) becomes the tour's internal ID. Stop files can be named anything; they are picked up in alphabetical order if a numbered prefix (`01-`, `02-`, …) is used.

### 2 · Write `tour.yaml`

```yaml
route_name: "Cissbury Ring"
subtitle: "Iron Age Hillfort · South Downs"      # shown in the route header
description: "England's second-largest Iron Age hillfort, raised over Neolithic flint mines."
icon: "🪨"
total_distance: "2.4 km"                         # optional meta chip
duration: "~70 min"                              # optional meta chip
stops:
  - "cissbury-entrance"                          # matches stop id: in frontmatter
  - "cissbury-summit"
```

| Field | Required | Notes |
|---|---|---|
| `route_name` | ✓ | Display name |
| `description` | ✓ | Shown on the tour card |
| `icon` | ✓ | Emoji used as a fallback thumbnail label |
| `subtitle` | | Short descriptor (period, location) |
| `total_distance` | | Displayed as a chip |
| `duration` | | Displayed as a chip |
| `stops` | ✓ | Ordered list of stop IDs |

### 3 · Write a stop file

Each stop is a Markdown file. The filename must include the stop ID — either as the whole filename (`cissbury-entrance.md`) or with a numbered prefix (`01-cissbury-entrance.md`). The YAML frontmatter `id:` field must match the ID listed in `tour.yaml`.

```markdown
---
id: cissbury-entrance
title: "The Entrance Causeway"
era: "Iron Age hillfort · c. 400 BC"      # eyebrow label shown above the title
grid_ref: "TQ 139 080"                    # meta chip
elevation: "156m AOD"                     # meta chip
walk_time: "start here"                   # shown next to upcoming stops on the route map
lat: 50.8561
lng: -0.3790
proximity_radius: 50                      # metres — triggers the GPS arrival ping
hero:
  src: "/tours/cissbury-ring/entrance.jpg"
  caption: "West entrance · looking north"
evidence: |
  Visible earthworks define a substantial enclosure on the hilltop.
interpretation: |
  The scale and prominence may have supported gatherings, signalling, or movement through the landscape.
---

The main body of the stop is standard Markdown.

Inline media is embedded using standard image syntax — the build pipeline
chooses the right HTML element from the file extension:

![A photo caption](entrance.jpg)          ← becomes <img loading="lazy">
![Audio description](narration.mp3)       ← becomes <audio controls>
![Video caption](drone.mp4)               ← becomes <video playsinline controls>
![3D model label](fort.glb)               ← becomes a styled 3D stub

Relative paths resolve from the route's media folder in `public/tours/<route-id>/`.
Absolute paths (`/tours/cissbury-ring/...`) also work.
```

#### Frontmatter reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | ✓ | Must match the entry in `tour.yaml` |
| `title` | string | ✓ | Displayed as the stop heading |
| `lat` / `lng` | number | | GPS coordinates; omit for stops with no fixed location |
| `proximity_radius` | number | | Metres to trigger arrival ping (default: 30) |
| `era` | string | | Eyebrow label above the title (e.g. "Neolithic · 3500 BC") |
| `grid_ref` | string | | OS grid reference shown as a chip |
| `elevation` | string | | Shown as a chip (e.g. "156m AOD") |
| `walk_time` | string | | Walking time from previous stop; shown on the route map |
| `hero` | object | | `{ src, caption }` — large image at the top of the stop |
| `evidence` | string | | Collapsible **Evidence** accordion (observable facts) |
| `interpretation` | string | | Collapsible **Interpretation** accordion (analysis) |

### 4 · Add media files

Place media in `public/tours/<route-id>/`:

```
public/
└── tours/
    └── cissbury-ring/
        ├── entrance.jpg     ← hero image or inline image
        ├── narration.mp3    ← audio commentary
        ├── drone.mp4        ← video
        └── fort.glb         ← 3D model (stub rendered, viewer TBD)
```

Files in `public/` are served at `/` in the browser. The service worker precaches everything under `public/tours/` so it works offline once visited.

#### Supported media types

| Extension | Rendered as |
|---|---|
| `.jpg` `.jpeg` `.png` `.webp` `.gif` | `<img loading="lazy">` |
| `.mp3` `.ogg` `.wav` | `<audio controls>` |
| `.mp4` `.webm` | `<video playsinline controls>` |
| `.glb` `.gltf` | Styled placeholder (3D viewer stub) |

---

## Themes

The app ships with three themes toggled by the sun/moon button in the header:

| Theme | Use case |
|---|---|
| **Light** | Daytime — warm parchment tones |
| **Dark** | Evening — low-glare dark surfaces |
| **Night** | Fieldwork after dark — red-amber only; preserves night vision |

The active theme persists to `localStorage`. To change the default, edit `src/lib/theme/store.ts` — change the fallback in the `createThemeStore` function from `'light'` to `'dark'` or `'night'`.

The whole system is CSS custom properties on `[data-theme]` in `src/app.css` — safe to retheme without touching any component.

---

## Deployment

The build outputs a static site in `dist/`. It works on any static host.

### Configure the base path

If your site is not at the root of a domain (e.g. `https://example.com/tour/` instead of `https://example.com/`), set `base` in `vite.config.ts`:

```ts
export default defineConfig({
  base: '/tour/',   // ← add this line
  plugins: [ … ],
})
```

Leave it unset (or `'/'`) for root-domain hosting.

### GitHub Pages

**Method A — manual**

```bash
npm run build
# Push dist/ to your gh-pages branch, or drag-drop to the Pages upload UI
```

**Method B — GitHub Actions (recommended)**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

Then go to **Settings → Pages → Source → GitHub Actions**.

If the repo is at `github.com/<user>/<repo>` and Pages serves it at `https://<user>.github.io/<repo>/`, set `base: '/<repo>/'` in `vite.config.ts`.

### Netlify

```bash
npm run build
# Drag-drop dist/ onto app.netlify.com/drop, or connect the repo via the Netlify UI.
```

With repo-connected auto-deploy, set:

- **Build command:** `npm run build`
- **Publish directory:** `dist`

No `_redirects` file is needed — the PWA uses hash routing so there are no server-side path redirects required.

### Vercel

```bash
npm i -g vercel
vercel --prod
```

Or connect the GitHub repo in the Vercel dashboard. Build preset: **Vite**.

---

## Installing to a phone

Once deployed, any visitor can install the app to their home screen. It then launches full-screen with no browser chrome, and works completely offline.

### iOS (Safari)

1. Open the tour URL in **Safari** (Chrome on iOS cannot install PWAs).
2. Tap the **Share** button (the box with an upward arrow) in the bottom toolbar.
3. Scroll down and tap **Add to Home Screen**.
4. Edit the name if you like, then tap **Add**.

The app icon appears on the home screen. Open it to trigger the first offline cache (this requires a connection). After that, it works without signal.

> **Tip for tour leaders:** Share the URL with participants before the walk and ask them to install it on Wi-Fi. The app caches all stops, fonts, and media — around 1–3 MB for a typical tour.

### Android (Chrome)

1. Open the tour URL in **Chrome**.
2. Tap the **⋮ menu** (top-right) and choose **Add to Home screen** (or **Install app**).
3. Tap **Install**.

On some Android devices Chrome shows an **install banner** at the bottom of the screen automatically after a few visits.

### Testing offline

1. Install the app or open it in Chrome desktop.
2. Open **DevTools → Application → Service Workers** — confirm the SW is registered and active.
3. Open **DevTools → Network → Offline** (tick the checkbox).
4. Reload and navigate — all stops and media should load from cache.

---

## Adding a second tour

1. Copy the example route folder:
   ```bash
   cp -r content/routes/cissbury-ring content/routes/my-new-tour
   ```
2. Edit `content/routes/my-new-tour/tour.yaml` — set `route_name`, `description`, `stops`.
3. Rename and edit the stop files in `stops/`.
4. Add media to `public/tours/my-new-tour/`.
5. Rebuild: `npm run build && npm run preview`.

The tour appears automatically in the library — no code changes needed.

---

## Tests

```bash
npm test           # run once
npx vitest         # watch mode
npm run check      # type check only
```

| File | Covers |
|---|---|
| `src/lib/geo/store.test.ts` | Haversine distance · accuracy-aware proximity · `createProximityStore` |
| `src/lib/content/content.test.ts` | Windows-safe routeId · YAML manifest parsing · numbered-prefix regex |

---

## License

MIT
