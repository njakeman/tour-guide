// @ts-nocheck — plain JS script (same conventions as scripts/import-survey.mjs):
// no shebang (this file is `import`ed by its test and Vite's SSR transform
// rejects a leading `#!`), invoked via an explicit `node` prefix.
/**
 * GitHub Issue Form → tour content generator.
 *
 * The three issue forms in .github/ISSUE_TEMPLATE/ (new-tour, add-stop,
 * edit-stop) submit structured markdown. This script turns one submitted issue
 * into content/ + public/ file changes, validates them with the same
 * invariants content.test.ts enforces, and leaves the git work (branch, PR) to
 * .github/workflows/content-from-issue.yml.
 *
 * Usage (CI): GITHUB_EVENT_PATH=<event.json> node scripts/issue-to-content.mjs
 *        (local): node scripts/issue-to-content.mjs <event.json>
 *
 * Layers, all exported for tests:
 *   parseIssueForm / detectKind      issue body  → { label: value }
 *   parseCoordinates / coordWarnings lat/lng text → numbers (+ sanity warnings)
 *   findRefs / parseMediaField       media references in markdown / form fields
 *   plan{NewTour,AddStop,EditStop}   async, no writes: returns a plan
 *   applyPlan                        writes the plan to disk
 *
 * The media pipeline downloads every attachment (GitHub user-attachments or a
 * plain https URL), sniffs its real type from the bytes (attachment URLs have
 * no extension), enforces the allowed-type/size rules, stores it under
 * public/tours/<tour>/ and emits `![caption](/tours/…)` — vite-plugin.ts then
 * renders by extension (image / video / audio / 3D model).
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  rmSync,
  appendFileSync,
} from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import matter from 'gray-matter'
import yaml from 'js-yaml'
import { readZipEntries, slugify, buildTourYaml, validateGeneratedRoute } from './import-survey.mjs'

// ---------------------------------------------------------------------------
// Form vocabulary — these strings are the `label:` of each field in the
// templates (GitHub renders each as a `### <label>` heading in the issue body).
// scripts/issue-templates.test.ts-style coverage lives in issue-to-content.test.ts
// and fails if a template drifts from this list.
// ---------------------------------------------------------------------------

export const LABELS = {
  tour: 'Tour',
  tourId: 'Tour id',
  routeName: 'Route name',
  subtitle: 'Subtitle',
  description: 'Description',
  icon: 'Icon',
  totalDistance: 'Total distance',
  duration: 'Duration',
  stopId: 'Stop id',
  stopTitle: 'Stop title',
  after: 'Insert after stop id',
  lat: 'Latitude',
  lng: 'Longitude',
  radius: 'Proximity radius (m)',
  era: 'Era',
  gridRef: 'Grid reference',
  elevation: 'Elevation',
  walkTime: 'Walk time',
  evidence: 'Evidence',
  interpretation: 'Interpretation',
  body: 'Body',
  hero: 'Hero photo',
  photos: 'Photos & video',
  extras: 'Audio & 3D models',
  del: 'Delete stop',
}
const KNOWN_LABELS = new Set(Object.values(LABELS))

export const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const NO_RESPONSE = '_No response_'
const CLEAR = '-' // edit forms: a lone "-" clears an optional field
const MEDIA_MARKER = '{{media}}'

export const MAX_BYTES = {
  image: 10 * 1024 * 1024,
  video: 40 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  model: 20 * 1024 * 1024,
  zip: 60 * 1024 * 1024,
}
const KIND_OF_EXT = {
  png: 'image',
  jpg: 'image',
  webp: 'image',
  gif: 'image',
  mp4: 'video',
  mp3: 'audio',
  glb: 'model',
  gltf: 'model',
  zip: 'zip',
}
const EXT_ALIASES = { jpeg: 'jpg' }
const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'model/gltf-binary': 'glb',
  'model/gltf+json': 'gltf',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
}

// ---------------------------------------------------------------------------
// Issue body parsing
// ---------------------------------------------------------------------------

/**
 * Splits an issue-form body on `### <label>` headings. Only headings that are
 * a *known* field label split — a stop body is free markdown and routinely
 * contains its own `### Subheading` lines, which must stay in the value.
 * `_No response_` (GitHub's marker for an empty field) becomes ''.
 * @returns {Record<string, string>}
 */
export function parseIssueForm(body, known = KNOWN_LABELS) {
  const text = String(body ?? '').replace(/\r\n?/g, '\n')
  const marks = [...text.matchAll(/^### (.+?)[ \t]*$/gm)].filter((m) => known.has(m[1].trim()))
  const out = {}
  marks.forEach((m, i) => {
    const start = m.index + m[0].length
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length
    const val = text.slice(start, end).trim()
    out[m[1].trim()] = val === NO_RESPONSE ? '' : val
  })
  return out
}

/** Which form was submitted — decided from the body, not labels/title (labels
 * only apply if they already exist in the repo; titles are user-editable). */
export function detectKind(form) {
  if (LABELS.routeName in form) return 'new-tour'
  if (LABELS.del in form) return 'edit-stop'
  if (LABELS.after in form) return 'add-stop'
  return null
}

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

const NUM = '[-+]?\\d+(?:\\.\\d+)?'
const PAIR_RE = new RegExp(`^\\(?\\s*(${NUM})\\s*[,;\\s]\\s*(${NUM})\\s*\\)?$`)

/**
 * Accepts lat and lng in their own fields, OR a pasted "50.857, -0.378" pair
 * (what a maps app copies) in the latitude field. Rounds to 6 dp (~0.1 m),
 * matching the survey importer. Returns { lat, lng, errors }.
 */
export function parseCoordinates(latRaw, lngRaw) {
  const errors = []
  let latS = (latRaw ?? '').trim()
  let lngS = (lngRaw ?? '').trim()
  const pair = PAIR_RE.exec(latS)
  if (pair && !lngS) {
    latS = pair[1]
    lngS = pair[2]
  }
  const lat = latS === '' ? null : Number(latS)
  const lng = lngS === '' ? null : Number(lngS)
  if (lat === null) errors.push('**Latitude** is required (e.g. `50.8570`, or paste `50.8570, -0.3780`).')
  else if (!Number.isFinite(lat)) errors.push(`**Latitude** \`${latS}\` is not a number.`)
  else if (Math.abs(lat) > 90) errors.push(`**Latitude** \`${latS}\` is out of range (−90 to 90).`)
  if (lng === null) errors.push('**Longitude** is required (e.g. `-0.3780`).')
  else if (!Number.isFinite(lng)) errors.push(`**Longitude** \`${lngS}\` is not a number.`)
  else if (Math.abs(lng) > 180) errors.push(`**Longitude** \`${lngS}\` is out of range (−180 to 180).`)
  if (errors.length) return { lat: null, lng: null, errors }
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), errors }
}

export function haversineKm(a, b) {
  const R = 6371
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Non-blocking sanity check: a point far from every other stop is usually a
 * swapped lat/lng or a dropped minus sign. Suggests the swapped reading when
 * that one lands near the tour.
 */
export function coordWarnings(point, others, thresholdKm = 10) {
  if (!others.length) return []
  const nearest = (p) => Math.min(...others.map((o) => haversineKm(p, o)))
  const d = nearest(point)
  if (d <= thresholdKm) return []
  let msg = `Coordinates ${point.lat}, ${point.lng} are ${d.toFixed(0)} km from the nearest existing stop — check the sign and that latitude/longitude aren't swapped.`
  if (Math.abs(point.lng) <= 90 && Math.abs(point.lat) <= 180) {
    const swapped = { lat: point.lng, lng: point.lat }
    if (nearest(swapped) <= thresholdKm) msg += ` Swapped (${swapped.lat}, ${swapped.lng}) would sit right next to the tour.`
  }
  return [msg]
}

// ---------------------------------------------------------------------------
// Media references
// ---------------------------------------------------------------------------

// One pass, four shapes GitHub/users produce:
//   ![alt](url)                              dragged image
//   <img … src="url" … alt="…">              dragged image (when resized)
//   [name.ext](…/user-attachments/files/…)   dragged file (zip, glb, …)
//   https://github.com/user-attachments/assets/<uuid>   dragged video (bare line)
const REF_RE = new RegExp(
  [
    String.raw`!\[([^\]]*)\]\(\s*(<?[^)\s>]+>?)(?:\s+"[^"]*")?\s*\)`,
    String.raw`<img\b[^>]*>`,
    String.raw`\[([^\]]*)\]\((https:\/\/github\.com\/user-attachments\/files\/[^)\s]+)\)`,
    String.raw`^(https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]+)[ \t]*$`,
  ].join('|'),
  'gm'
)

function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return m ? (m[1] ?? m[2] ?? '') : ''
}

/** GitHub names a dragged file's alt text after the file ("image", "IMG_1234"),
 * which is useless as a caption. */
export function cleanAlt(alt) {
  const a = (alt ?? '').trim()
  if (/^(image|img[_-]?\d+|screenshot.*|dsc[_-]?\d+|pxl_.*|video|file)$/i.test(a)) return ''
  // A dragged *file* link's text is its filename ("media.zip", "fort.glb").
  if (/^[^\s]+\.[a-z0-9]{2,4}$/i.test(a)) return ''
  return a
}

/** Every media reference in `text` — [{ start, end, url, alt }] in source order. */
export function findRefs(text) {
  const refs = []
  for (const m of String(text).matchAll(REF_RE)) {
    let url
    let alt = ''
    if (m[2] !== undefined) {
      url = m[2].replace(/^<|>$/g, '')
      alt = m[1]
    } else if (m[0].startsWith('<img')) {
      url = attr(m[0], 'src')
      alt = attr(m[0], 'alt')
    } else if (m[4] !== undefined) {
      url = m[4]
      alt = m[3]
    } else if (m[5] !== undefined) {
      url = m[5]
    }
    if (url) refs.push({ start: m.index, end: m.index + m[0].length, url, alt: cleanAlt(alt) })
  }
  return refs
}

/**
 * A media field (photos / audio+models / hero) → [{ url, caption }].
 * Per line: any reference shape above; `https://… | caption`; a bare https URL;
 * or a plain text line, which becomes the caption of the preceding item when
 * that has none.
 */
export function parseMediaField(text) {
  const items = []
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const refs = findRefs(line)
    if (refs.length) {
      for (const r of refs) items.push({ url: r.url, caption: r.alt })
      continue
    }
    const m = /^(https?:\/\/\S+?)\s*(?:\|\s*(.*))?$/.exec(line)
    if (m) {
      items.push({ url: m[1], caption: (m[2] ?? '').trim() })
      continue
    }
    const last = items[items.length - 1]
    if (last && !last.caption) last.caption = line
  }
  return items
}

/** Magic-byte sniff: attachment URLs carry no extension and servers often
 * answer application/octet-stream, so the bytes are the reliable signal. */
export function sniffExt(buf) {
  if (buf.length < 12) return null
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.toString('latin1', 0, 4) === 'GIF8') return 'gif'
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (buf.toString('latin1', 4, 8) === 'ftyp') return 'mp4'
  if (buf.toString('latin1', 0, 4) === 'glTF') return 'glb'
  if (buf.toString('latin1', 0, 2) === 'PK') return 'zip'
  if (buf.toString('latin1', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'mp3'
  return null
}

function extOfUrl(url) {
  try {
    const e = new URL(url).pathname.split('.').pop()?.toLowerCase() ?? ''
    return EXT_ALIASES[e] ?? e
  } catch {
    return ''
  }
}

function prettifyStem(name) {
  const stem = basename(name).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim()
  return stem ? stem[0].toUpperCase() + stem.slice(1) : ''
}

function mdCaption(s) {
  return (s ?? '').replace(/[[\]\r\n]+/g, ' ').trim()
}

/** Next unused `<stopId>-N` index in the tour's media folder (edits must not
 * overwrite photos an earlier submission added). */
function nextMediaIndex(mediaDir, stopId) {
  if (!existsSync(mediaDir)) return 1
  const re = new RegExp(`^${stopId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)\\.`)
  let max = 0
  for (const f of readdirSync(mediaDir)) {
    const m = re.exec(f)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

async function download(url, ctx) {
  if (!/^https:\/\//i.test(url)) throw new Error(`only https:// media URLs are supported (${url})`)
  const res = await ctx.fetchFn(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`download failed with HTTP ${res.status} (${url})`)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES.zip) throw new Error(`file is ${(declared / 1048576).toFixed(0)} MB — too large (${url})`)
  return { buf: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? '' }
}

/** Stores one file in the plan and returns { src, kind, caption } or null (error recorded). */
function commitFile(data, ext, caption, ctx, label) {
  const kind = KIND_OF_EXT[ext]
  if (!kind || kind === 'zip') {
    ctx.errors.push(`${label}: \`.${ext || '?'}\` is not a supported media type (png, jpg, webp, gif, mp4, mp3, glb, gltf).`)
    return null
  }
  if (data.length > MAX_BYTES[kind]) {
    ctx.errors.push(
      `${label}: ${(data.length / 1048576).toFixed(1)} MB exceeds the ${MAX_BYTES[kind] / 1048576} MB limit for ${kind} files (the tour is saved offline to a phone).`
    )
    return null
  }
  if (ext === 'gltf') ctx.warnings.push(`${label}: a bare .gltf references external buffers/textures that won't be uploaded — prefer a single .glb.`)
  const name = `${ctx.stopId}-${ctx.n++}.${ext}`
  ctx.writes.push({ path: join(ctx.publicRoot, 'tours', ctx.tourId, name), data })
  return { src: `/tours/${ctx.tourId}/${name}`, kind, caption }
}

/**
 * Downloads `url` and stores it (a zip is unpacked into several files).
 * Returns an array of { src, kind, caption }; errors are recorded on ctx.
 * Results are cached per URL so a repeated attachment is stored once.
 */
async function saveMedia(url, caption, ctx, { allowZip = false } = {}) {
  const cacheKey = `${url}|${allowZip}`
  // A zip's entries keep their own filename-derived captions; a caption given
  // for the zip as a whole would otherwise stamp every entry identically.
  const withCaption = (list) => (list.length === 1 ? list.map((r) => ({ ...r, caption: caption || r.caption })) : list)
  if (ctx.cache.has(cacheKey)) return withCaption(ctx.cache.get(cacheKey))
  let result = []
  try {
    const { buf, contentType } = await download(url, ctx)
    const ext =
      sniffExt(buf) ?? MIME_EXT[contentType.split(';')[0].trim().toLowerCase()] ?? extOfUrl(url)
    const label = `\`${url.length > 70 ? url.slice(0, 67) + '…' : url}\``
    if (ext === 'zip') {
      if (!allowZip) {
        ctx.errors.push(`${label}: zip files go in the **${LABELS.extras}** (or **${LABELS.photos}**) field, not inline in the body.`)
      } else if (buf.length > MAX_BYTES.zip) {
        ctx.errors.push(`${label}: zip exceeds ${MAX_BYTES.zip / 1048576} MB.`)
      } else {
        let entries
        try {
          entries = readZipEntries(buf)
        } catch (e) {
          ctx.errors.push(`${label}: could not read zip (${e.message}).`)
          entries = new Map()
        }
        for (const [name, data] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
          if (name.startsWith('__MACOSX/') || basename(name).startsWith('.')) continue
          const eExt = EXT_ALIASES[extOfUrl(`https://x/${name}`)] ?? extOfUrl(`https://x/${name}`)
          if (!KIND_OF_EXT[eExt] || eExt === 'zip') {
            ctx.warnings.push(`Skipped \`${name}\` in the zip — unsupported type.`)
            continue
          }
          const r = commitFile(data, eExt, prettifyStem(name), ctx, `\`${name}\``)
          if (r) result.push(r)
        }
      }
    } else {
      const r = commitFile(buf, ext, '', ctx, label)
      if (r) result = [r]
    }
  } catch (e) {
    ctx.errors.push(`\`${url}\`: ${e.message}`)
  }
  ctx.cache.set(cacheKey, result)
  return withCaption(result)
}

/** Rewrites remote media refs inside the body to local `![alt](/tours/…)`. */
async function rewriteBody(body, ctx) {
  const refs = findRefs(body).filter((r) => /^https?:\/\//i.test(r.url))
  let out = ''
  let cursor = 0
  for (const r of refs) {
    out += body.slice(cursor, r.start)
    const saved = await saveMedia(r.url, r.alt, ctx)
    out += saved.length
      ? saved.map((s) => `![${mdCaption(s.caption)}](${s.src})`).join('\n\n')
      : body.slice(r.start, r.end) // leave as-is; the error is already recorded
    cursor = r.end
  }
  return out + body.slice(cursor)
}

/**
 * Runs the whole media pipeline for one stop's fields.
 * Returns { body, hero } — `body` is null when the form had no body text and no
 * media (so an edit leaves the existing body alone).
 */
async function processMedia(f, ctx) {
  let hero = null
  if (f.hero) {
    const items = parseMediaField(f.hero)
    if (items.length > 1) ctx.warnings.push('Only the first **Hero photo** is used.')
    if (items[0]) {
      const [saved] = await saveMedia(items[0].url, items[0].caption, ctx)
      if (saved && saved.kind !== 'image') ctx.errors.push('**Hero photo** must be an image.')
      else if (saved) hero = { src: saved.src, caption: mdCaption(saved.caption) }
    } else {
      ctx.errors.push('**Hero photo** has no image or URL in it.')
    }
  }

  const extra = []
  for (const field of [f.photos, f.extras]) {
    for (const item of parseMediaField(field)) {
      extra.push(...(await saveMedia(item.url, item.caption, ctx, { allowZip: true })))
    }
  }
  const block = extra.map((s) => `![${mdCaption(s.caption)}](${s.src})`).join('\n\n')

  let body = f.body ? await rewriteBody(f.body, ctx) : null
  if (block) {
    if (body === null) body = block
    else if (body.includes(MEDIA_MARKER)) {
      const i = body.indexOf(MEDIA_MARKER)
      body = body.slice(0, i) + block + body.slice(i + MEDIA_MARKER.length).replaceAll(MEDIA_MARKER, '')
    } else body = `${body}\n\n${block}`
  } else if (body !== null) {
    body = body.replaceAll(MEDIA_MARKER, '')
  }
  return { body, hero }
}

// ---------------------------------------------------------------------------
// Tour/stop file helpers
// ---------------------------------------------------------------------------

function defaults(opts) {
  return {
    contentRoot: opts.contentRoot ?? 'content',
    publicRoot: opts.publicRoot ?? 'public',
    fetchFn: opts.fetchFn ?? globalThis.fetch,
  }
}

/** Stop file for an id — `<id>.md` or the numbered-prefix `NN-<id>.md`. */
export function findStopFile(stopsDir, id) {
  if (!existsSync(stopsDir)) return null
  const files = readdirSync(stopsDir)
  const m = files.find((f) => f === `${id}.md` || (/^\d{2}-/.test(f) && f.replace(/^\d{2}-/, '') === `${id}.md`))
  return m ? join(stopsDir, m) : null
}

function loadTour(contentRoot, tourId) {
  if (!ID_RE.test(tourId ?? '')) return null
  const dir = join(contentRoot, 'routes', tourId)
  const yamlPath = join(dir, 'tour.yaml')
  if (!existsSync(yamlPath)) return null
  const yamlText = readFileSync(yamlPath, 'utf-8')
  const data = yaml.load(yamlText) ?? {}
  const stopIds = (data.stops ?? []).map(String)
  const stopsDir = join(dir, 'stops')
  const points = []
  for (const id of stopIds) {
    const p = findStopFile(stopsDir, id)
    if (!p) continue
    const d = matter(readFileSync(p, 'utf-8'), {}).data
    if (typeof d.lat === 'number' && typeof d.lng === 'number') points.push({ lat: d.lat, lng: d.lng })
  }
  return { id: tourId, dir, yamlPath, yamlText, data, stopIds, stopsDir, points }
}

/**
 * Adds/removes one id in tour.yaml's `stops:` list with a *line* edit, not a
 * parse/dump, so the file's comments (the commented `map:` block, inline
 * notes) and quoting survive. The result is re-parsed to prove it.
 */
export function editStopList(yamlText, { insert, remove } = {}) {
  const nl = yamlText.includes('\r\n') ? '\r\n' : '\n'
  const lines = yamlText.split(/\r?\n/)
  const idx = lines.findIndex((l) => /^stops\s*:/.test(l))
  if (idx < 0) throw new Error('tour.yaml has no `stops:` list')
  const inline = lines[idx].replace(/^stops\s*:/, '').replace(/\s+#.*$/, '').trim()
  let indent = '  '
  let end = idx + 1
  let items
  if (inline) {
    items = (yaml.load(`stops: ${inline}`).stops ?? []).map((id) => `${indent}- ${JSON.stringify(String(id))}`)
    lines[idx] = 'stops:'
  } else {
    while (end < lines.length && /^\s*-\s+/.test(lines[end])) end++
    items = lines.slice(idx + 1, end)
    if (items[0]) indent = /^(\s*)/.exec(items[0])[1]
  }
  const idOf = (l) => String(yaml.load(l.replace(/^\s*-\s+/, '').replace(/\s+#.*$/, '')))
  let ids = items.map(idOf)
  if (remove != null) {
    const i = ids.indexOf(remove)
    if (i < 0) throw new Error(`stop '${remove}' is not in tour.yaml`)
    items.splice(i, 1)
  }
  if (insert) {
    const after = insert.afterId
    const pos = !after ? items.length : after === 'start' ? 0 : ids.indexOf(after) + 1
    if (after && after !== 'start' && pos === 0) throw new Error(`stop '${after}' is not in tour.yaml`)
    items.splice(pos, 0, `${indent}- ${JSON.stringify(insert.id)}`)
  }
  lines.splice(idx + 1, end - (idx + 1), ...items)
  const result = lines.join(nl)
  const expected = items.map(idOf)
  const actual = (yaml.load(result).stops ?? []).map(String)
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('internal error: tour.yaml stops edit did not round-trip')
  return result
}

function stringifyStop(data, body) {
  return `---\n${yaml.dump(data, { lineWidth: -1, noRefs: true })}---\n\n${body.trim()}\n`
}

function readStopFields(form) {
  const g = (k) => (form[k] ?? '').trim()
  return {
    id: g(LABELS.stopId),
    title: g(LABELS.stopTitle),
    after: g(LABELS.after),
    lat: g(LABELS.lat),
    lng: g(LABELS.lng),
    radius: g(LABELS.radius),
    era: g(LABELS.era),
    gridRef: g(LABELS.gridRef),
    elevation: g(LABELS.elevation),
    walkTime: g(LABELS.walkTime),
    evidence: g(LABELS.evidence),
    interpretation: g(LABELS.interpretation),
    body: g(LABELS.body),
    hero: g(LABELS.hero),
    photos: g(LABELS.photos),
    extras: g(LABELS.extras),
    del: /\[x\]/i.test(form[LABELS.del] ?? ''),
  }
}

function parseRadius(raw, errors) {
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 5 || n > 1000) {
    errors.push(`**Proximity radius** \`${raw}\` must be a number between 5 and 1000 (metres).`)
    return null
  }
  return Math.round(n)
}

function newCtx(o, tourId, stopId) {
  return {
    fetchFn: o.fetchFn,
    publicRoot: o.publicRoot,
    tourId,
    stopId,
    n: nextMediaIndex(join(o.publicRoot, 'tours', tourId), stopId),
    cache: new Map(),
    writes: [],
    errors: [],
    warnings: [],
  }
}

function summarise(plan) {
  const lines = []
  for (const w of plan.writes) lines.push(`- \`${w.path.replace(/\\/g, '/')}\`${Buffer.isBuffer(w.data) ? ` (${(w.data.length / 1024).toFixed(0)} KB)` : ''}`)
  for (const d of plan.deletes) lines.push(`- ~~\`${d.replace(/\\/g, '/')}\`~~ (deleted)`)
  return lines.join('\n')
}

/** Shared add-a-stop core (used by Add stop and by New tour's first stop). */
async function buildNewStop(f, { tourId, existingIds, points }, o, ctx) {
  const { errors, warnings } = ctx
  if (!f.title) errors.push('**Stop title** is required.')
  let id = f.id || slugify(f.title)
  if (f.id && !ID_RE.test(f.id)) errors.push(`**Stop id** \`${f.id}\` must be lowercase letters, digits and hyphens (try \`${slugify(f.id)}\`).`)
  if (!id) errors.push('Could not derive a stop id — fill in **Stop id**.')
  else if (existingIds.includes(id)) errors.push(`A stop with id \`${id}\` already exists in \`${tourId}\` — set a different **Stop id**.`)
  const coords = parseCoordinates(f.lat, f.lng)
  errors.push(...coords.errors)
  if (coords.lat !== null) warnings.push(...coordWarnings(coords, points))
  const radius = parseRadius(f.radius, errors) ?? 30
  if (!f.evidence) errors.push('**Evidence** is required.')
  if (!f.body && !f.photos && !f.extras) errors.push('**Body** is required (or attach photos/media).')

  ctx.stopId = id || 'stop'
  ctx.n = nextMediaIndex(join(o.publicRoot, 'tours', tourId), ctx.stopId)
  const { body, hero } = await processMedia(f, ctx)
  if (errors.length) return null

  const data = { id, title: f.title }
  if (f.era) data.era = f.era
  if (f.gridRef) data.grid_ref = f.gridRef
  if (f.elevation) data.elevation = f.elevation
  if (f.walkTime) data.walk_time = f.walkTime
  data.lat = coords.lat
  data.lng = coords.lng
  data.proximity_radius = radius
  if (hero) data.hero = hero
  data.evidence = f.evidence
  if (f.interpretation) data.interpretation = f.interpretation
  return { id, markdown: stringifyStop(data, body ?? '') }
}

// ---------------------------------------------------------------------------
// Planners — async, no filesystem writes. Each returns
// { kind, tourId, stopId, title, writes:[{path,data}], deletes:[path], errors, warnings, summary }
// ---------------------------------------------------------------------------

function finish(kind, base, ctx, extra = {}) {
  const plan = {
    kind,
    writes: ctx.writes,
    deletes: [],
    errors: ctx.errors,
    warnings: ctx.warnings,
    ...base,
    ...extra,
  }
  if (plan.errors.length) {
    plan.writes = []
    plan.deletes = []
  }
  plan.summary = summarise(plan)
  return plan
}

export async function planNewTour(form, opts = {}) {
  const o = defaults(opts)
  const g = (k) => (form[k] ?? '').trim()
  const name = g(LABELS.routeName)
  const ctx = newCtx(o, 'pending', 'stop-1')
  const { errors } = ctx
  if (!name) errors.push('**Route name** is required.')
  if (!g(LABELS.description)) errors.push('**Description** is required.')
  const tourId = g(LABELS.tourId) || slugify(name)
  if (g(LABELS.tourId) && !ID_RE.test(g(LABELS.tourId))) errors.push(`**Tour id** \`${g(LABELS.tourId)}\` must be lowercase letters, digits and hyphens (try \`${slugify(g(LABELS.tourId))}\`).`)
  else if (!tourId) errors.push('Could not derive a tour id — fill in **Tour id**.')
  else if (existsSync(join(o.contentRoot, 'routes', tourId))) errors.push(`A tour with id \`${tourId}\` already exists.`)
  ctx.tourId = tourId || 'pending'

  const f = readStopFields(form)
  const stop = await buildNewStop(f, { tourId, existingIds: [], points: [] }, o, ctx)
  if (errors.length || !stop) return finish('new-tour', { tourId, stopId: null, title: `New tour: ${name || '(unnamed)'}` }, ctx)

  const coords = parseCoordinates(f.lat, f.lng)
  const routeDir = join(o.contentRoot, 'routes', tourId)
  const tourYaml = buildTourYaml({
    id: tourId,
    routeName: name,
    subtitle: g(LABELS.subtitle),
    description: g(LABELS.description),
    icon: g(LABELS.icon),
    totalDistance: g(LABELS.totalDistance),
    duration: g(LABELS.duration),
    stopIds: [stop.id],
    centerLng: coords.lng,
    centerLat: coords.lat,
  })
  ctx.writes.push(
    { path: join(routeDir, 'tour.yaml'), data: tourYaml },
    { path: join(routeDir, 'stops', `${stop.id}.md`), data: stop.markdown }
  )
  ctx.warnings.push('No `map:` block yet — a `.pmtiles` basemap must be added by hand (the block is left commented out in `tour.yaml`).')
  return finish('new-tour', { tourId, stopId: stop.id, title: `New tour: ${name}` }, ctx)
}

export async function planAddStop(form, opts = {}) {
  const o = defaults(opts)
  const f = readStopFields(form)
  const tourId = (form[LABELS.tour] ?? '').trim()
  const ctx = newCtx(o, tourId || 'pending', f.id || slugify(f.title) || 'stop')
  const tour = loadTour(o.contentRoot, tourId)
  if (!tour) {
    ctx.errors.push(`Tour \`${tourId || '(none selected)'}\` does not exist in \`content/routes/\`.`)
    return finish('add-stop', { tourId, stopId: null, title: `Add stop: ${f.title || '(untitled)'}` }, ctx)
  }
  if (f.after && f.after !== 'start' && !tour.stopIds.includes(f.after)) {
    ctx.errors.push(`**Insert after stop id** \`${f.after}\` is not in \`${tourId}\` (stops: ${tour.stopIds.map((s) => `\`${s}\``).join(', ')}; or \`start\`).`)
  }
  const stop = await buildNewStop(f, { tourId, existingIds: tour.stopIds, points: tour.points }, o, ctx)
  const base = { tourId, stopId: stop?.id ?? null, title: `Add stop: ${f.title || '(untitled)'} (${tourId})` }
  if (ctx.errors.length || !stop) return finish('add-stop', base, ctx)

  ctx.writes.push(
    { path: join(tour.dir, 'stops', `${stop.id}.md`), data: stop.markdown },
    { path: tour.yamlPath, data: editStopList(tour.yamlText, { insert: { id: stop.id, afterId: f.after } }) }
  )
  return finish('add-stop', base, ctx)
}

export async function planEditStop(form, opts = {}) {
  const o = defaults(opts)
  const f = readStopFields(form)
  const tourId = (form[LABELS.tour] ?? '').trim()
  const ctx = newCtx(o, tourId || 'pending', f.id || 'stop')
  const base = { tourId, stopId: f.id || null, title: `Edit stop: ${f.id || '(none)'} (${tourId})` }
  const { errors, warnings } = ctx
  const tour = loadTour(o.contentRoot, tourId)
  if (!tour) {
    errors.push(`Tour \`${tourId || '(none selected)'}\` does not exist in \`content/routes/\`.`)
    return finish('edit-stop', base, ctx)
  }
  if (!f.id) {
    errors.push('**Stop id** is required.')
    return finish('edit-stop', base, ctx)
  }
  const stopPath = tour.stopIds.includes(f.id) ? findStopFile(tour.stopsDir, f.id) : null
  if (!stopPath) {
    errors.push(`Stop \`${f.id}\` is not in \`${tourId}\` (stops: ${tour.stopIds.map((s) => `\`${s}\``).join(', ')}).`)
    return finish('edit-stop', base, ctx)
  }

  if (f.del) {
    if (tour.stopIds.length === 1) {
      errors.push('Cannot delete the only stop — a tour needs at least one.')
      return finish('edit-stop', base, ctx)
    }
    ctx.writes.push({ path: tour.yamlPath, data: editStopList(tour.yamlText, { remove: f.id }) })
    warnings.push(`Media previously uploaded for \`${f.id}\` is left in \`public/tours/${tourId}/\` (unreferenced files are not added to the offline manifest).`)
    return finish('edit-stop', { ...base, title: `Delete stop: ${f.id} (${tourId})` }, ctx, { deletes: [stopPath] })
  }

  const parsed = matter(readFileSync(stopPath, 'utf-8'), {})
  const data = structuredClone(parsed.data)
  let body = parsed.content

  // Blank keeps; "-" clears an optional field; anything else replaces.
  const setText = (key, val) => {
    if (!val) return
    if (val === CLEAR) delete data[key]
    else data[key] = val
  }
  if (f.title === CLEAR) errors.push('**Stop title** cannot be cleared.')
  else if (f.title) data.title = f.title
  setText('era', f.era)
  setText('grid_ref', f.gridRef)
  setText('elevation', f.elevation)
  setText('walk_time', f.walkTime)
  if (f.evidence === CLEAR) errors.push('**Evidence** cannot be cleared.')
  else if (f.evidence) data.evidence = f.evidence
  setText('interpretation', f.interpretation)
  const radius = parseRadius(f.radius, errors)
  if (radius !== null) data.proximity_radius = radius

  if (f.lat || f.lng) {
    // A single changed coordinate is fine: the other keeps its current value.
    const latRaw = f.lat || String(data.lat ?? '')
    const lngRaw = f.lng || String(data.lng ?? '')
    const c = parseCoordinates(latRaw, lngRaw)
    errors.push(...c.errors)
    if (!c.errors.length) {
      data.lat = c.lat
      data.lng = c.lng
      const others = tour.points.filter((p) => !(p.lat === parsed.data.lat && p.lng === parsed.data.lng))
      warnings.push(...coordWarnings(c, others))
    }
  }

  const media = await processMedia(f, ctx)
  if (media.hero) data.hero = media.hero
  if (media.body !== null) {
    // A filled Body replaces the whole body; media alone is appended to it.
    body = f.body ? media.body : `${body.trim()}\n\n${media.body}`
  }

  if (!errors.length && !body.trim()) errors.push('The stop body would be empty.')
  if (!errors.length && JSON.stringify(data) === JSON.stringify(parsed.data) && body === parsed.content) {
    warnings.push('Nothing to change — every field was blank.')
  }
  if (errors.length) return finish('edit-stop', base, ctx)
  ctx.writes.push({ path: stopPath, data: stringifyStop(data, body) })
  return finish('edit-stop', base, ctx)
}

/** Dispatches on the form kind. */
export async function planFromIssueBody(body, opts = {}) {
  const form = parseIssueForm(body)
  const kind = detectKind(form)
  if (kind === 'new-tour') return planNewTour(form, opts)
  if (kind === 'add-stop') return planAddStop(form, opts)
  if (kind === 'edit-stop') return planEditStop(form, opts)
  return {
    kind: null,
    tourId: null,
    stopId: null,
    title: 'Unrecognised issue',
    writes: [],
    deletes: [],
    errors: ['This issue does not look like one of the content forms (New tour / Add stop / Edit stop). Open one from **New issue** rather than a blank issue.'],
    warnings: [],
    summary: '',
  }
}

export function applyPlan(plan) {
  for (const w of plan.writes) {
    mkdirSync(dirname(w.path), { recursive: true })
    writeFileSync(w.path, w.data)
  }
  for (const d of plan.deletes) rmSync(d, { force: true })
}

// ---------------------------------------------------------------------------
// CLI — wired up by .github/workflows/content-from-issue.yml
// ---------------------------------------------------------------------------

function mdList(items) {
  return items.map((e) => `- ${e}`).join('\n')
}

export function renderResult(plan, issueNumber) {
  if (plan.errors.length) {
    return [
      `Couldn't turn this issue into content yet:`,
      '',
      mdList(plan.errors),
      '',
      '**Edit the issue** to fix it — this runs again automatically on every edit.',
    ].join('\n')
  }
  const out = [`Generated from #${issueNumber}.`, '', '### Files', plan.summary]
  if (plan.warnings.length) out.push('', '### Check these', mdList(plan.warnings))
  out.push('', `Closes #${issueNumber}`)
  return out.join('\n')
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value).replace(/[\r\n]+/g, ' ')}\n`)
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH ?? process.argv[2]
  if (!eventPath) {
    console.error('Usage: GITHUB_EVENT_PATH=<event.json> node scripts/issue-to-content.mjs   (or pass the path as an argument)')
    process.exit(2)
  }
  const issue = JSON.parse(readFileSync(eventPath, 'utf-8')).issue
  const outFile = join(process.env.RUNNER_TEMP ?? tmpdir(), 'issue-result.md')
  const fail = (plan) => {
    writeFileSync(outFile, renderResult(plan, issue.number))
    setOutput('result_file', outFile)
    console.error(renderResult(plan, issue.number))
    process.exit(1)
  }

  const plan = await planFromIssueBody(issue.body)
  if (plan.errors.length) fail(plan)
  applyPlan(plan)
  try {
    // Scoped to the stop this issue touched (see validateGeneratedRoute).
    validateGeneratedRoute(join('content', 'routes', plan.tourId), 'public', {
      onlyStops: plan.stopId ? [plan.stopId] : [],
    })
  } catch (e) {
    plan.errors.push(e.message)
    fail(plan)
  }

  writeFileSync(outFile, renderResult(plan, issue.number))
  setOutput('result_file', outFile)
  setOutput('title', plan.title)
  console.log(renderResult(plan, issue.number))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
