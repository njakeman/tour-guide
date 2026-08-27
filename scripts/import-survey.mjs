#!/usr/bin/env node
// @ts-nocheck — plain JS script (matches scripts/seed-demo.mjs, scripts/optimize-media.mjs);
// not part of the checkJs project graph except via the test file's import below.
/**
 * Survey-export zip → tour skeleton importer.
 *
 * Turns one survey-tool export zip (see survey-export-zip-spec.md) into a
 * complete-but-unfinished tour: content/routes/<id>/tour.yaml + stops/*.md
 * (one per surveyed feature) and public/tours/<id>/ photos, ready for
 * `npm run dev`/`npm run test`. Every field that needs prose is a literal
 * "TODO" placeholder — the app owner fills those in by hand afterwards.
 *
 * Usage:
 *   npm run tour:import -- <zip> [--id <slug>] [--name "Human Name"] [--subtitle "..."] [--force]
 *
 * Deliberately out of scope (see AUTHORING.md "Importing a survey export"):
 * re-import/upsert by obs_id, revisit sessions (survey_revisit is ignored —
 * a revisit zip imports as an ordinary survey), audio (voice notes are
 * reported and skipped), and basemap generation (no pmtiles tooling here).
 *
 * Zero npm dependencies for zip reading (central-directory reader +
 * zlib.inflateRawSync) — same zero-dependency style as scripts/seed-demo.mjs.
 * gray-matter/js-yaml (already devDependencies, used to read content at
 * build time) are reused here to validate what this script just wrote.
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { join, basename } from 'node:path'
import zlib from 'node:zlib'
import readline from 'node:readline/promises'
import { pathToFileURL } from 'node:url'
import matter from 'gray-matter'
import yaml from 'js-yaml'

// ---------------------------------------------------------------------------
// Zip reading
// The spec (§1) warns that client-zip writes entries with data descriptors,
// so local file headers report size 0 — sizes must come from the central
// directory, not the local header. We read the central directory only; the
// local header is consulted just to find where each entry's file data
// starts (past its name/extra fields), never for sizes.
// ---------------------------------------------------------------------------

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_DIR_SIGNATURE = 0x02014b50

/** Reads a zip buffer into a Map<entryName, decompressed Buffer>. */
export function readZipEntries(buf) {
  const searchFloor = Math.max(0, buf.length - 22 - 0xffff)
  let eocd = -1
  for (let i = buf.length - 22; i >= searchFloor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a valid zip file: end-of-central-directory record not found')

  const entryCount = buf.readUInt16LE(eocd + 10)
  const centralDirOffset = buf.readUInt32LE(eocd + 16)

  const entries = new Map()
  let p = centralDirOffset
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(p) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error(`Malformed zip: central directory entry ${i} has a bad signature`)
    }
    const method = buf.readUInt16LE(p + 10)
    const compressedSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localHeaderOffset = buf.readUInt32LE(p + 42)
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf-8')

    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26)
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen
    const compressed = buf.slice(dataStart, dataStart + compressedSize)

    let data
    if (method === 0) data = compressed
    else if (method === 8) data = zlib.inflateRawSync(compressed)
    else throw new Error(`Unsupported zip compression method ${method} for entry "${name}"`)

    if (!name.endsWith('/')) entries.set(name, data)
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Lowercase, ASCII, hyphenated slug — safe as a stop/route id (matches
 * content.test.ts's literal + RegExp id usage: keep it [a-z0-9-]). */
export function slugify(input) {
  const s = (input ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s.slice(0, 60)
}

/**
 * Per survey-export-zip-spec.md §2.1 + the approved import design:
 *   Point / anything else → properties.lat/lon, falling back to geometry
 *   LineString             → the FIRST coordinate (where the walk starts)
 *   Polygon                → properties.lat/lon (the exporter's own centroid),
 *                             falling back to the ring's coordinate mean
 */
export function stopPosition(feature) {
  const pr = feature.properties ?? {}
  const geom = feature.geometry ?? {}

  if (geom.type === 'LineString' && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) {
    const [lng, lat] = geom.coordinates[0]
    return { lat, lng }
  }

  if (geom.type === 'Polygon') {
    if (typeof pr.lat === 'number' && typeof pr.lon === 'number') {
      return { lat: pr.lat, lng: pr.lon }
    }
    const ring = geom.coordinates?.[0] ?? []
    if (ring.length > 0) {
      let sumLng = 0
      let sumLat = 0
      for (const [lng, lat] of ring) {
        sumLng += lng
        sumLat += lat
      }
      return { lat: sumLat / ring.length, lng: sumLng / ring.length }
    }
  }

  if (typeof pr.lat === 'number' && typeof pr.lon === 'number') {
    return { lat: pr.lat, lng: pr.lon }
  }
  if (Array.isArray(geom.coordinates) && typeof geom.coordinates[0] === 'number') {
    return { lat: geom.coordinates[1], lng: geom.coordinates[0] }
  }
  return { lat: null, lng: null }
}

/** Stop title candidate: first sentence/clause of the note, else the
 * surveyor's own feature_label, else "Stop N" (survey-export-zip-spec.md §5). */
export function titleFromNote(note, featureLabel, index) {
  const trimmed = (note ?? '').trim()
  if (trimmed) {
    const firstLine = trimmed.split(/\r?\n/)[0].trim()
    const sentence = firstLine.match(/^.*?[.!?](?=\s|$)/)
    const clause = sentence ? sentence[0] : firstLine
    return clause.length > 60 ? `${clause.slice(0, 57).trimEnd()}…` : clause
  }
  const label = (featureLabel ?? '').trim()
  if (label) return label
  return `Stop ${index}`
}

/** Photo entry names (under photos/) in capture order — modern photos[]
 * array, falling back to the legacy `photo` string (sample.zip's shape,
 * survey-export-zip-spec.md §2.2 "legacy: photos[0].photo"). */
export function photosOf(properties) {
  if (Array.isArray(properties?.photos) && properties.photos.length > 0) {
    return properties.photos.map((p) => p.photo).filter(Boolean)
  }
  if (properties?.photo) return [properties.photo]
  return []
}

/** A YAML double-quoted scalar — JSON string escaping is a compatible
 * subset, so this is always valid regardless of quotes/colons/newlines. */
function yamlString(s) {
  return JSON.stringify(s)
}

function escapeMd(s) {
  return s.replace(/</g, '&lt;')
}

// ---------------------------------------------------------------------------
// Content generation
// ---------------------------------------------------------------------------

export function buildTourYaml({ id, routeName, subtitle, stopIds, centerLng, centerLat }) {
  const lines = [
    `route_name: ${yamlString(routeName)}`,
    `subtitle: ${subtitle ? yamlString(subtitle) : '"TODO — one-line subtitle"'}`,
    `description: "TODO — write a 1-2 sentence description of this tour."`,
    `icon: "🚩"  # TODO — pick an icon`,
    `total_distance: "TODO — total distance"`,
    `duration: "TODO — duration"`,
    ``,
    `# TODO — add a PMTiles basemap (public/tours/${id}/${id}.pmtiles), then uncomment:`,
    `# map:`,
    `#   basemap: "/tours/${id}/${id}.pmtiles"`,
    `#   center: [${centerLng}, ${centerLat}]`,
    `#   zoom: 16`,
    ``,
    `stops:`,
    ...stopIds.map((id) => `  - ${yamlString(id)}`),
  ]
  return lines.join('\n') + '\n'
}

export function buildStopMarkdown(stop) {
  const fm = [
    `id: ${yamlString(stop.id)}`,
    `title: ${yamlString(stop.title)}`,
    `era: "TODO — era / period"`,
    `grid_ref: ${stop.gridRef ? yamlString(stop.gridRef) : '"TODO — grid reference"'}`,
    `elevation: ${stop.elevation ? yamlString(stop.elevation) : '"TODO — elevation"'}`,
    `walk_time: "TODO — walk time from the previous stop"`,
    `lat: ${stop.lat}`,
    `lng: ${stop.lng}`,
    `proximity_radius: 30`,
  ]

  if (stop.heroSrc) {
    fm.push(`hero:`, `  src: ${yamlString(stop.heroSrc)}`, `  caption: "TODO — hero caption"`)
  }

  fm.push(
    `# Provenance from the survey import — not read by the app, safe to edit/remove.`,
    `survey:`,
    `  obs_id: ${yamlString(stop.obsId)}`,
    `  recorded_at: ${yamlString(stop.recordedAt)}`,
    `  position_source: ${yamlString(stop.positionSource)}`,
    `  gps_accuracy_m: ${stop.gpsAccuracyM ?? 'null'}`,
    `  heading_deg: ${stop.headingDeg ?? 'null'}`,
    `  trace_length_m: ${stop.traceLengthM ?? 'null'}`,
  )

  const evidenceLines = ['TODO — describe what is physically visible/measurable at this stop.']
  const note = (stop.note ?? '').trim()
  if (note) {
    evidenceLines.push('', `Surveyor's note:`, ...note.split(/\r?\n/))
  }
  fm.push(`evidence: |`, ...evidenceLines.map((l) => (l ? `  ${l}` : '')))
  fm.push(`interpretation: |`, `  TODO — add interpretation once the evidence is written.`)

  const frontmatter = `---\n${fm.join('\n')}\n---`

  const body = [`# ${stop.title}`, '', 'TODO — write the story of this stop.']
  if (note) {
    body.push('', `> Surveyor's note: "${escapeMd(note)}"`)
  }
  if (!stop.heroSrc) {
    body.push('', '<!-- TODO: no photo was captured for this stop — add a hero image above. -->')
  }
  if (stop.bodyPhotos.length > 0) {
    body.push('', '## Photographs')
    for (const p of stop.bodyPhotos) body.push('', `![TODO — caption](${p.src})`)
  }
  body.push('')

  return `${frontmatter}\n\n${body.join('\n')}`
}

/**
 * Pure planning step: reads the parsed session.geojson and returns every
 * file to write, with no filesystem access. `id` is the route directory
 * name (already chosen/validated by the caller).
 */
export function buildImportPlan(session, { id, routeName, subtitle }) {
  const features = Array.isArray(session.features) ? session.features : []
  if (features.length === 0) {
    throw new Error('This survey export has no features — nothing to import.')
  }

  const warnings = []
  const usedSlugs = new Set()
  const stops = []
  const photoCopyPlan = []
  const audioSkipped = []

  features.forEach((feature, i) => {
    const index = i + 1
    const pr = feature.properties ?? {}
    const title = titleFromNote(pr.note, pr.feature_label, index)

    const baseSlug = slugify(title) || `stop-${index}`
    let slug = baseSlug
    let suffix = 2
    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${suffix}`
      suffix++
    }
    usedSlugs.add(slug)

    const pos = stopPosition(feature)
    const lat = typeof pos.lat === 'number' ? Number(pos.lat.toFixed(6)) : null
    const lng = typeof pos.lng === 'number' ? Number(pos.lng.toFixed(6)) : null

    const nn = String(index).padStart(2, '0')
    const photoUlids = photosOf(pr)
    const destPhotoNames = photoUlids.map((_, k) => `${nn}-${slug}-${k + 1}.jpg`)
    photoUlids.forEach((ulid, k) => {
      photoCopyPlan.push({ zipName: `photos/${ulid}`, destName: destPhotoNames[k] })
    })

    if (pr.audio) {
      audioSkipped.push({ stopTitle: title, zipName: `audio/${pr.audio}` })
    }

    const heroSrc = destPhotoNames.length > 0 ? `/tours/${id}/${destPhotoNames[0]}` : null
    const bodyPhotos = destPhotoNames.slice(1).map((name) => ({ src: `/tours/${id}/${name}` }))
    if (!heroSrc) {
      warnings.push(`Stop "${title}" has no photos — add one by hand.`)
    }

    const filename = `${nn}-${slug}.md`
    const markdownText = buildStopMarkdown({
      id: slug,
      title,
      gridRef: pr.os_grid_ref ?? null,
      elevation: typeof pr.altitude_m === 'number' ? `${Math.round(pr.altitude_m)}m AOD` : null,
      lat,
      lng,
      heroSrc,
      bodyPhotos,
      note: pr.note ?? '',
      obsId: pr.obs_id ?? '',
      recordedAt: pr.recorded_at ?? '',
      positionSource: pr.position_source ?? '',
      gpsAccuracyM: typeof pr.gps_accuracy_m === 'number' ? pr.gps_accuracy_m : null,
      headingDeg: typeof pr.heading_deg === 'number' ? pr.heading_deg : null,
      traceLengthM: typeof pr.trace_length_m === 'number' ? pr.trace_length_m : null,
    })

    stops.push({ index, slug, filename, markdownText, lat, lng })
  })

  const located = stops.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number')
  const centerLat = located.length
    ? Number((located.reduce((sum, s) => sum + s.lat, 0) / located.length).toFixed(6))
    : 0
  const centerLng = located.length
    ? Number((located.reduce((sum, s) => sum + s.lng, 0) / located.length).toFixed(6))
    : 0

  const tourYamlText = buildTourYaml({
    id,
    routeName,
    subtitle,
    stopIds: stops.map((s) => s.slug),
    centerLng,
    centerLat,
  })

  let routeGeojsonText = null
  if (located.length >= 2) {
    const geojson = {
      type: 'Feature',
      properties: { name: `${routeName} walking route` },
      geometry: { type: 'LineString', coordinates: located.map((s) => [s.lng, s.lat]) },
    }
    routeGeojsonText = JSON.stringify(geojson, null, 2) + '\n'
  }

  return { id, tourYamlText, stops, routeGeojsonText, photoCopyPlan, audioSkipped, warnings }
}

// ---------------------------------------------------------------------------
// Filesystem writes
// ---------------------------------------------------------------------------

/**
 * @param {ReturnType<typeof buildImportPlan>} plan
 * @param {Map<string, Buffer>} zipEntries
 * @param {{ contentRoot?: string, publicRoot?: string, sessionRaw?: Buffer }} [opts]
 */
export function writePlan(plan, zipEntries, { contentRoot = 'content', publicRoot = 'public', sessionRaw } = {}) {
  const routeDir = join(contentRoot, 'routes', plan.id)
  const stopsDir = join(routeDir, 'stops')
  const mediaDir = join(publicRoot, 'tours', plan.id)
  mkdirSync(stopsDir, { recursive: true })
  mkdirSync(mediaDir, { recursive: true })

  writeFileSync(join(routeDir, 'tour.yaml'), plan.tourYamlText)
  for (const stop of plan.stops) writeFileSync(join(stopsDir, stop.filename), stop.markdownText)
  if (plan.routeGeojsonText) writeFileSync(join(routeDir, 'route.geojson'), plan.routeGeojsonText)
  if (sessionRaw) writeFileSync(join(routeDir, 'survey-session.geojson'), sessionRaw)

  let mediaBytes = 0
  for (const { zipName, destName } of plan.photoCopyPlan) {
    const data = zipEntries.get(zipName)
    if (!data) throw new Error(`Zip is missing a file its own session.geojson references: ${zipName}`)
    writeFileSync(join(mediaDir, destName), data)
    mediaBytes += data.length
  }

  return { routeDir, mediaDir, mediaBytes }
}

/**
 * Re-reads what was just written and checks the same invariants
 * src/lib/content/content.test.ts enforces against the real content tree —
 * a generated route is under that test immediately, so failing loudly here
 * (before the author ever sees it) beats failing in `npm run test` later.
 */
export function validateGeneratedRoute(routeDir, publicRoot = 'public') {
  const tourYaml = yaml.load(readFileSync(join(routeDir, 'tour.yaml'), 'utf-8'))
  if (!tourYaml.route_name) throw new Error('Validation failed: tour.yaml has no route_name')
  if (!Array.isArray(tourYaml.stops) || tourYaml.stops.length === 0) {
    throw new Error('Validation failed: tour.yaml has no stops')
  }

  const stopsDir = join(routeDir, 'stops')
  const files = readdirSync(stopsDir)
  for (const stopId of tourYaml.stops) {
    const match = files.find(
      (f) => f === `${stopId}.md` || (/^\d{2}-/.test(f) && f.replace(/^\d{2}-/, '') === `${stopId}.md`)
    )
    if (!match) throw new Error(`Validation failed: stop '${stopId}' has no matching file in ${stopsDir}`)

    const parsed = matter(readFileSync(join(stopsDir, match), 'utf-8'))
    const f = parsed.data
    if (!f.id) throw new Error(`Validation failed: ${match} has no id`)
    if (!f.title) throw new Error(`Validation failed: ${match} has no title`)
    if (!f.evidence) throw new Error(`Validation failed: ${match} has no evidence`)
    if (f.lat != null && (typeof f.lat !== 'number' || typeof f.lng !== 'number')) {
      throw new Error(`Validation failed: ${match} has a non-numeric lat/lng`)
    }
    if (!parsed.content.trim()) throw new Error(`Validation failed: ${match} has an empty body`)

    if (f.hero?.src) {
      const heroPath = join(publicRoot, f.hero.src.replace(/^\//, ''))
      if (!existsSync(heroPath) || statSync(heroPath).size === 0) {
        throw new Error(`Validation failed: ${match}'s hero image is missing on disk: ${f.hero.src}`)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { force: false }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--id') opts.id = argv[++i]
    else if (a === '--name') opts.name = argv[++i]
    else if (a === '--subtitle') opts.subtitle = argv[++i]
    else if (a === '--force') opts.force = true
    else positional.push(a)
  }
  opts.zipPath = positional[0]
  return opts
}

function prettifyStem(stem) {
  return stem
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function looksLikeBareDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test((s ?? '').trim())
}

async function promptWithDefault(rl, question, def) {
  const answer = (await rl.question(def ? `${question} [${def}]: ` : `${question}: `)).trim()
  return answer || def
}

async function main() {
  const argv = parseArgs(process.argv.slice(2))
  if (!argv.zipPath) {
    console.error(
      'Usage: npm run tour:import -- <zip> [--id <slug>] [--name "Human Name"] [--subtitle "..."] [--force]'
    )
    process.exitCode = 1
    return
  }

  const zipBuf = readFileSync(argv.zipPath)
  const zipEntries = readZipEntries(zipBuf)
  const sessionRaw = zipEntries.get('session.geojson')
  if (!sessionRaw) throw new Error(`${argv.zipPath} has no session.geojson — is this a survey export?`)
  const session = JSON.parse(sessionRaw.toString('utf-8'))

  const sessionName = session.survey_session?.name ?? ''
  const stem = basename(argv.zipPath).replace(/\.zip$/i, '')
  const nameDefault = sessionName && !looksLikeBareDate(sessionName) ? sessionName : prettifyStem(stem)

  const interactive = Boolean(process.stdin.isTTY)
  const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null

  let name = argv.name
  if (!name) name = interactive ? await promptWithDefault(rl, 'Tour name', nameDefault) : nameDefault

  let id = argv.id
  if (!id) {
    const idDefault = slugify(name)
    id = interactive ? await promptWithDefault(rl, 'Route id (directory name)', idDefault) : idDefault
  }

  let subtitle = argv.subtitle
  if (subtitle === undefined) {
    subtitle = interactive ? await promptWithDefault(rl, 'Subtitle (optional)', '') : ''
  }

  rl?.close()

  const routeDir = join('content', 'routes', id)
  const mediaDir = join('public', 'tours', id)
  if (!argv.force && (existsSync(routeDir) || existsSync(mediaDir))) {
    throw new Error(
      `content/routes/${id} or public/tours/${id} already exists. Pass --force to overwrite generated files in place.`
    )
  }

  const plan = buildImportPlan(session, { id, routeName: name, subtitle })
  const { mediaBytes } = writePlan(plan, zipEntries, { sessionRaw })
  validateGeneratedRoute(routeDir)

  console.log('')
  console.log(`Imported ${plan.stops.length} stop(s) into content/routes/${id}/`)
  console.log(
    `Copied ${plan.photoCopyPlan.length} photo(s), ${(mediaBytes / 1024 / 1024).toFixed(1)} MB, into public/tours/${id}/ — these will be committed to git.`
  )
  if (plan.audioSkipped.length > 0) {
    console.log('')
    console.log(`Skipped ${plan.audioSkipped.length} voice note(s) — audio is not imported:`)
    for (const a of plan.audioSkipped) console.log(`  - ${a.zipName}  (${a.stopTitle})`)
  }
  for (const w of plan.warnings) console.log(`Warning: ${w}`)
  console.log('')
  console.log('TODO before this tour is ready:')
  console.log(`  - Add a PMTiles basemap and uncomment the map: block in content/routes/${id}/tour.yaml`)
  console.log('  - Write description, subtitle, total_distance, duration in tour.yaml')
  console.log('  - Write era, walk_time, evidence, interpretation, and captions for each stop')
  console.log('')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
