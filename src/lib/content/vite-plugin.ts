import type { Plugin, ResolvedConfig } from 'vite'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, resolve, basename } from 'path'
import matter from 'gray-matter'
import yaml from 'js-yaml'
import { Marked } from 'marked'
import type { TourStop, TourRoute, TourMap, MediaItem, HeroImage } from '../types'

// Re-export types so virtual-content.d.ts can reference them from this file too
export type { TourStop, TourRoute, TourMap, MediaItem, HeroImage }

// ---------------------------------------------------------------------------
// Base-path handling
// Captured from Vite's resolved config so that absolute content paths like
// /tours/cissbury-ring/entrance.png are correctly prefixed when the app is
// served from a sub-path (e.g. /tour-guide/ on GitHub Pages).
// Authors keep writing /tours/… — the plugin rewrites at build time.
// ---------------------------------------------------------------------------
let assetBase = '/'

/**
 * Prepend the Vite base to a root-relative path (e.g. /tours/x.png →
 * /tour-guide/tours/x.png). External URLs and data URIs are left unchanged.
 * `base` is injectable for tests; defaults to the resolved Vite base.
 */
export function withBase(href: string, base: string = assetBase): string {
  if (!href) return href
  if (/^(https?:)?\/\//.test(href) || href.startsWith('data:')) return href
  // Already has the correct base (idempotent guard)
  const trimmed = base.replace(/\/$/, '')
  if (trimmed && href.startsWith(trimmed + '/')) return href
  return trimmed + '/' + href.replace(/^\//, '')
}

/** Escape a string for use in HTML text or double-quoted attribute values. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ---------------------------------------------------------------------------
// Media renderer
// Standard markdown image syntax: ![caption](path/to/file.ext)
// Extension is used to determine the rendered HTML element.
// ---------------------------------------------------------------------------
// Anything not matched below (jpg/png/webp/svg/… and unknown extensions)
// renders as an image figure.
const AUDIO_EXTS = new Set(['mp3', 'ogg', 'wav', 'flac', 'm4a'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'ogv'])
const MODEL_EXTS = new Set(['glb', 'gltf'])

/**
 * Render one media reference to HTML. Exported for unit tests;
 * `base` overrides the resolved Vite base when provided.
 */
export function renderMediaHtml(href: string, text: string, base?: string): string {
  const src = escapeHtml(withBase(href, base))
  const caption = escapeHtml(text)
  const ext = href.split('.').pop()?.toLowerCase() ?? ''
  const cap = text ? `<figcaption>${caption}</figcaption>` : ''

  if (AUDIO_EXTS.has(ext)) {
    return `<figure class="media-audio"><audio controls preload="metadata"><source src="${src}" /></audio>${cap}</figure>`
  }
  if (VIDEO_EXTS.has(ext)) {
    return `<figure class="media-video"><video controls preload="metadata" playsinline><source src="${src}" /></video>${cap}</figure>`
  }
  if (MODEL_EXTS.has(ext)) {
    const label = escapeHtml(href.split('/').pop() ?? '3D model')
    return `<div class="media-model" data-src="${src}" data-caption="${caption}"><span class="model-stub" aria-label="3D model">⬡</span><p class="model-label">${label}</p>${cap}</div>`
  }
  // Images, plus fallback for unknown extensions
  return `<figure class="media-img"><img src="${src}" alt="${caption}" loading="lazy" />${cap}</figure>`
}

const markedInstance = new Marked({
  renderer: {
    image({ href = '', text = '' }: { href?: string; text?: string; title?: string | null }) {
      return renderMediaHtml(href, text)
    },
  },
})

// ---------------------------------------------------------------------------
// Content resolution
// ---------------------------------------------------------------------------
const CONTENT_DIR = 'content'
const ROUTES_DIR = 'routes'

function loadTourRoute(routeDir: string): TourRoute {
  const tourYamlPath = join(routeDir, 'tour.yaml')

  if (!existsSync(tourYamlPath)) {
    throw new Error(`Missing tour.yaml in ${routeDir}`)
  }

  const tourYaml = yaml.load(readFileSync(tourYamlPath, 'utf-8')) as {
    route_name: string
    subtitle?: string
    description: string
    icon?: string
    total_distance?: string
    duration?: string
    map?: {
      basemap: string
      center?: [number, number]
      zoom?: number
    }
    stops: string[]
  }

  const stopsDir = join(routeDir, 'stops')
  const stops: TourStop[] = []

  for (const stopId of tourYaml.stops) {
    let stopPath = join(stopsDir, `${stopId}.md`)

    if (!existsSync(stopPath)) {
      // Try shared stops directory
      const sharedPath = resolve(CONTENT_DIR, 'shared', 'stops', `${stopId}.md`)
      if (existsSync(sharedPath)) {
        stopPath = sharedPath
      } else if (existsSync(stopsDir)) {
        // Try numbered-prefix convention: "01-cissbury-entrance" etc.
        // Compare the de-prefixed filename to the id literally rather than
        // interpolating the id into a RegExp — a stop id with regex
        // metacharacters (e.g. "stop.1") would otherwise match the wrong
        // file or throw on an unbalanced bracket.
        const files = readdirSync(stopsDir)
        const match = files.find(
          (f) => /^\d{2}-/.test(f) && f.replace(/^\d{2}-/, '') === `${stopId}.md`
        )
        if (match) {
          stopPath = join(stopsDir, match)
        } else {
          throw new Error(
            `Stop '${stopId}' not found.\n` +
              `  Tried: ${join(stopsDir, stopId + '.md')}\n` +
              `  Tried: ${sharedPath}\n` +
              `  Numbered prefix: no '??-${stopId}.md' in ${stopsDir}`
          )
        }
      } else {
        throw new Error(`Stop '${stopId}' not found and stops directory missing: ${stopsDir}`)
      }
    }

    const raw = readFileSync(stopPath, 'utf-8')
    const parsed = matter(raw)
    const front = parsed.data as {
      id?: string
      title?: string
      era?: string
      grid_ref?: string
      elevation?: string
      walk_time?: string
      lat?: number
      lng?: number
      proximity_radius?: number
      evidence?: string
      interpretation?: string
      hero?: HeroImage
      media?: MediaItem[]
    }

    // Render markdown body to HTML at build time
    const bodyHtml = markedInstance.parse(parsed.content ?? '') as string

    // Rewrite hero.src with the base path so it resolves correctly on
    // sub-path hosts (e.g. /tour-guide/tours/… on GitHub Pages).
    const hero: HeroImage | undefined = front.hero
      ? { ...front.hero, src: withBase(front.hero.src) }
      : undefined

    stops.push({
      id: front.id ?? stopId,
      title: front.title ?? 'Untitled Stop',
      era: front.era,
      grid_ref: front.grid_ref,
      elevation: front.elevation,
      walk_time: front.walk_time,
      lat: front.lat ?? null,
      lng: front.lng ?? null,
      proximity_radius: front.proximity_radius ?? 30,
      evidence: front.evidence ?? '',
      interpretation: front.interpretation ?? '',
      bodyHtml,
      // Rewrite each media src through the base path too (same as hero.src /
      // map.basemap) so frontmatter-declared media resolves on sub-path hosts.
      media: (front.media ?? []).map((m) => ({ ...m, src: withBase(m.src) })),
      hero,
    })
  }

  // Use path.basename to safely extract the directory name on any OS
  const routeId = basename(routeDir)

  // Rewrite the basemap path through withBase() so it's correct on sub-path hosts
  // (same mechanism as hero.src). Authors always write /tours/… in tour.yaml.
  const tourMap: TourMap | undefined = tourYaml.map?.basemap
    ? {
        basemap: withBase(tourYaml.map.basemap),
        center: tourYaml.map.center,
        zoom: tourYaml.map.zoom,
      }
    : undefined

  return {
    id: routeId,
    name: tourYaml.route_name,
    subtitle: tourYaml.subtitle,
    description: tourYaml.description,
    icon: tourYaml.icon ?? '🗺️',
    total_distance: tourYaml.total_distance,
    duration: tourYaml.duration,
    map: tourMap,
    stops,
  }
}

// ---------------------------------------------------------------------------
// Vite plugin
// ---------------------------------------------------------------------------
export function contentPlugin(): Plugin {
  const virtualModuleId = 'virtual:tour-content'
  const resolvedVirtualModuleId = '\0' + virtualModuleId
  // Only the content/ directory (POSIX-normalised) — anchoring the HMR check
  // here stops it also firing for edits to src/lib/content/*.ts.
  const contentRoot = resolve(CONTENT_DIR).split('\\').join('/')
  let isBuild = false

  function generateModule(): string {
    const routesPath = resolve(CONTENT_DIR, ROUTES_DIR)
    if (!existsSync(routesPath)) {
      // In dev an empty content tree is tolerable; a production build shipping
      // zero tours is almost certainly a misconfiguration — fail loudly.
      if (isBuild) throw new Error(`[content] Routes directory not found: ${routesPath}`)
      return `export const routes = []; export const allStops = [];`
    }

    const routes: TourRoute[] = []
    const routeDirs = readdirSync(routesPath, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(routesPath, d.name))

    for (const routeDir of routeDirs) {
      try {
        routes.push(loadTourRoute(routeDir))
      } catch (err) {
        // Dev: warn and keep the server up. Build: a typo in tour.yaml must
        // fail CI rather than silently ship a green build missing that tour.
        console.warn(`[content] Failed to load route at ${routeDir}:`, err)
        if (isBuild) throw err
      }
    }

    if (isBuild && routes.length === 0) {
      throw new Error(`[content] No tours loaded from ${routesPath} — refusing to build empty content.`)
    }

    const allStops = routes.flatMap((r) => r.stops)
    const routesJson = JSON.stringify(routes)
    const stopsJson = JSON.stringify(allStops)

    return `export const routes = ${routesJson};\nexport const allStops = ${stopsJson};\nexport default { routes, allStops };`
  }

  return {
    name: 'tour-content',
    configResolved(config: ResolvedConfig) {
      // Capture the resolved base so withBase() prefixes correctly.
      // Defaults to '/' for local dev and root-serving hosts.
      assetBase = config.base ?? '/'
      isBuild = config.command === 'build'
    },
    resolveId(id) {
      if (id === virtualModuleId) return resolvedVirtualModuleId
    },
    load(id) {
      if (id === resolvedVirtualModuleId) return generateModule()
    },
    handleHotUpdate({ file, server }) {
      const normalized = file.split('\\').join('/')
      if (normalized.startsWith(contentRoot + '/')) {
        const mod = server.moduleGraph.getModuleById(resolvedVirtualModuleId)
        if (mod) {
          server.moduleGraph.invalidateModule(mod)
          return [mod]
        }
      }
    },
  }
}
