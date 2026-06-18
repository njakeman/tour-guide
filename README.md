# fieldWorks

An offline-first PWA for handheld walking tours — hillforts, henges, barrows, and heritage trails. Tours are authored in Markdown, work without a network connection once installed, and install directly to an iOS or Android home screen.

Built with Svelte 5 · Vite 7 · vite-plugin-pwa / Workbox · three-way Light / Dark / Night theming.

---

## Quick start

Requires **Node.js 20+**.

```bash
npm install          # install dependencies
npm run demo:seed    # generate placeholder media for the demo tour
npm run dev          # dev server at http://localhost:5173
npm test             # run unit tests (vitest)
npm run check        # type-check (svelte-check + tsc)
npm run build        # production build → dist/
npm run preview      # serve dist/ locally to test PWA
```

Or in one command: `npm run demo` (seed + dev server).

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

## Authoring a tour / whitelabel branding

See **[AUTHORING.md](AUTHORING.md)** for the full step-by-step guide covering:

- Setting your app identity (name, manifest, title)
- Rebranding in one file (`src/styles/brand.css` — Light, Dark, Night token sets)
- Tour folder layout, `tour.yaml` fields, stop frontmatter reference
- Inline media syntax (`![caption](file.ext)` → right element by extension)
- Demo tour: `npm run demo:seed` generates placeholder media for every type (image, audio, video, 3D)

---

## Themes

Three themes — **Light**, **Dark**, **Night** — toggled by the sun/moon button in the header.
Night mode uses red-amber only to preserve dark-adapted vision in the field.

All colour and font values live in `src/styles/brand.css`. Edit that file to rebrand; no component
files need to change. The active theme persists to `localStorage`.

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
