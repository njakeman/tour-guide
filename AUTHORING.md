# fieldWorks — Authoring Guide

How to take the fieldWorks template, brand it, and build a tour from scratch.

---

## Overview

fieldWorks has a clean separation between the **engine** (Svelte + Vite, never touch) and the **content** (your tours, your brand):

```
src/styles/brand.css          ← YOUR BRAND — colours, fonts, all three themes
content/routes/<tour>/        ← YOUR TOURS — markdown + YAML
public/tours/<tour>/          ← YOUR MEDIA — images, audio, video, 3D models
```

Everything else is the engine. A rebrand or a new tour never requires touching a `.svelte` file.

---

## Step 1 — Clone and run the demo

```bash
git clone https://github.com/your-org/fieldworks
cd fieldworks
npm install

# Generate placeholder media for the demo Cissbury Ring tour:
npm run demo:seed

# Start the dev server:
npm run dev
```

`npm run demo:seed` writes placeholder files into `public/tours/cissbury-ring/` (gitignored).
Open http://localhost:5173 to see the demo tour with all media types working: hero image, inline
image, audio, video, and 3D model stub.

---

## Step 2 — Set your app identity

Edit two files:

### `vite.config.ts` — manifest
```ts
manifest: {
  name: 'My Tour App',          // ← full name (shown on install screen)
  short_name: 'My Tours',       // ← home screen label
  description: 'A guided tour of …',
  theme_color: '#f3eede',       // ← match your Light theme --bg
  background_color: '#f3eede',
  …
}
```

### `index.html` — browser tab title
```html
<title>My Tour App</title>
```

---

## Step 3 — Brand the app (one file)

Open `src/styles/brand.css`. It contains three blocks — Light, Dark, Night — each made of CSS
custom properties. Change the values; nothing else needs to touch.

```css
/* ── Light (default) ── */
:root,
[data-theme="light"] {
  --bg:        #f3eede;   /* page background */
  --accent:    #b06a33;   /* primary action colour — buttons, pins, progress */
  --olive:     #6e7551;   /* secondary — GPS ping, "done" state */
  --eyebrow:   #8a4f22;   /* small-caps labels above headings */
  …
}
```

**Fonts** — the defaults are Spectral (serif), Hanken Grotesk (sans), Spline Sans Mono (mono).
To change them:
1. Install a new `@fontsource/<family>` package: `npm i @fontsource/eb-garamond`
2. Import the weights you need in `src/main.ts`: `import '@fontsource/eb-garamond/400.css'`
3. Update `--font-serif` in `src/styles/brand.css`: `--font-serif: 'EB Garamond', Georgia, serif;`

The Night theme uses only red-amber values (no blue or green). Keep it that way — it preserves
dark-adapted vision in the field.

---

## Step 4 — Create a tour

### Folder layout

```
content/routes/
└── my-tour/                      ← folder name = tour ID (no spaces)
    ├── tour.yaml                 ← route manifest
    └── stops/
        ├── my-first-stop.md
        └── my-second-stop.md

public/tours/
└── my-tour/                      ← media for this tour (commit these)
    ├── cover.jpg
    ├── narration.mp3
    └── model.glb
```

### `tour.yaml`

```yaml
route_name: "Chanctonbury Ring"
subtitle: "Beech grove & hillfort · South Downs"   # shown in route header
description: "A circuit of one of Sussex's most atmospheric hilltops."
icon: "🌳"
total_distance: "3.2 km"    # optional — shown as a chip
duration: "~90 min"         # optional — shown as a chip
stops:
  - "chanct-approach"       # matches the id: field in each stop file
  - "chanct-grove"
  - "chanct-ramparts"
```

---

## Step 5 — Write a stop

Each stop is a `.md` file. The filename must contain the stop ID — either the whole filename
(`chanct-approach.md`) or with a numbered prefix (`01-chanct-approach.md`).

```markdown
---
id: chanct-approach
title: "The Approach Path"
era: "Bronze Age barrows · c. 1500 BC"
grid_ref: "TQ 139 121"
elevation: "238m AOD"
walk_time: "15 min from car park"
lat: 50.8967
lng: -0.4389
proximity_radius: 40
hero:
  src: "/tours/chanctonbury/approach.jpg"
  caption: "Approaching from the south · looking north"
evidence: |
  A line of Bronze Age bowl barrows is visible on the approach ridge.
interpretation: |
  The barrows mark the processional approach to the summit and its later hillfort.
---

The main body is standard Markdown — headings, lists, blockquotes, and inline media.

## Inline media

Use standard image syntax. The file extension determines the rendered element:

![A caption for the image](/tours/chanctonbury/approach.jpg)
![Audio commentary](/tours/chanctonbury/narration.mp3)
![Video walkthrough](/tours/chanctonbury/flythrough.mp4)
![3D model of a barrow](/tours/chanctonbury/barrow.glb)
```

### Frontmatter reference

| Field | Required | Description |
|---|---|---|
| `id` | ✓ | Must match entry in `tour.yaml` |
| `title` | ✓ | Stop heading (Spectral serif) |
| `lat` / `lng` | | GPS coordinates for proximity detection |
| `proximity_radius` | | Metres before "arriving" triggers (default: 30) |
| `era` | | Eyebrow label above the title |
| `grid_ref` | | Shown as a chip (OS grid ref or any string) |
| `elevation` | | Shown as a chip |
| `walk_time` | | Walking time from previous stop; shown on route map |
| `hero.src` | | Path to hero image (absolute `/tours/…`) |
| `hero.caption` | | Caption shown over the hero plate |
| `evidence` | | Text for the collapsible Evidence accordion |
| `interpretation` | | Text for the collapsible Interpretation accordion |

### Inline media extensions

| Extension | Rendered as |
|---|---|
| `.jpg` `.jpeg` `.png` `.webp` `.gif` | `<img loading="lazy">` in a figure |
| `.mp3` `.ogg` `.wav` `.m4a` | `<audio controls>` |
| `.mp4` `.webm` | `<video playsinline controls>` |
| `.glb` `.gltf` | Styled 3D stub (placeholder until a viewer is wired in) |

If a hero image path is wrong or missing, the app shows a procedural contour-art fallback
automatically — no broken images.

---

## Step 6 — Add media files

Place media in `public/tours/<tour-id>/`. These are committed to the repository along with your
content — they are real assets, not generated.

```
public/tours/
└── chanctonbury/
    ├── approach.jpg        ← hero image or inline image
    ├── narration.mp3       ← audio commentary
    ├── flythrough.mp4      ← video (keep under ~50 MB for good offline UX)
    └── barrow.glb          ← 3D model
```

Files here are served at `/tours/chanctonbury/…` in the browser and are runtime-cached by
the service worker (`CacheFirst`, 60-day TTL) — so once a user has visited a stop, it works
offline.

> **vs the demo tour:** `public/tours/cissbury-ring/` is **gitignored** because those files are
> generated by `npm run demo:seed`. Your real tour's media folder should be committed normally.

---

## Step 7 — Build and deploy

```bash
npm run build       # outputs to dist/
npm run preview     # test locally (check offline works in DevTools → Network → Offline)
```

See `README.md` for full deployment instructions (GitHub Pages, Netlify, Vercel) and iOS/Android
"Add to Home Screen" steps.

---

## Adding a second tour

1. Create `content/routes/<new-tour>/tour.yaml` and `stops/` directory.
2. Add media to `public/tours/<new-tour>/`.
3. Rebuild — the tour appears in the library automatically.

No code changes required.

---

## Demo tour notes

The included Cissbury Ring tour is a **demonstration** of every feature:
- Hero images
- Inline image, audio (`.mp3`), video (`.mp4`), and 3D model (`.glb`)
- GPS coordinates and proximity detection
- Evidence and Interpretation accordions
- Meta chips (grid ref, elevation, walk time)

Its media lives in `public/tours/cissbury-ring/` which is gitignored. To regenerate:

```bash
npm run demo:seed
```

To replace the demo with your own content, delete `content/routes/cissbury-ring/` and
`public/tours/cissbury-ring/`, and remove the gitignore entry for the latter.
