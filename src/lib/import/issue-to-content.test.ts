import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import matter from 'gray-matter'
import yaml from 'js-yaml'
import {
  LABELS,
  parseIssueForm,
  detectKind,
  parseCoordinates,
  coordWarnings,
  findRefs,
  parseMediaField,
  sniffExt,
  editStopList,
  planNewTour,
  planAddStop,
  planEditStop,
  planFromIssueBody,
  applyPlan,
} from '../../../scripts/issue-to-content.mjs'
import { renderTemplate, listTourIds, TEMPLATES_WITH_TOUR_DROPDOWN } from '../../../scripts/sync-issue-templates.mjs'
import { validateGeneratedRoute } from '../../../scripts/import-survey.mjs'
import { loadTourRoute } from '../content/vite-plugin'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PNG = Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n'), Buffer.alloc(40, 1)])
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)])
const MP4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(40, 3)])
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(40, 4)])
const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(40, 5)])
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40, 6)])

/** Stored-only zip, enough for readZipEntries. */
function zipOf(files: Record<string, Buffer>): Buffer {
  const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, data] of Object.entries(files)) {
    const nb = Buffer.from(name)
    const lh = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0), u32(data.length), u32(data.length), u16(nb.length), u16(0), nb])
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0), u32(data.length), u32(data.length), u16(nb.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nb]))
    local.push(lh, data)
    offset += lh.length + data.length
  }
  const cd = Buffer.concat(central)
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cd.length), u32(offset), u16(0)])
  return Buffer.concat([...local, cd, eocd])
}

type Remote = Record<string, { buf: Buffer; type?: string; status?: number }>
const fetchOf = (remote: Remote) => async (url: string) => {
  const r = remote[url]
  if (!r) return new Response('nope', { status: 404 })
  return new Response(new Uint8Array(r.buf), { status: r.status ?? 200, headers: { 'content-type': r.type ?? 'application/octet-stream' } })
}

/** An issue-form body, in the exact shape GitHub renders. */
function body(fields: Record<string, string>): string {
  return Object.entries(fields).map(([k, v]) => `### ${k}\n\n${v === '' ? '_No response_' : v}`).join('\n\n')
}

const ASSET = 'https://github.com/user-attachments/assets/11111111-2222-3333-4444-555555555555'
const ASSET2 = 'https://github.com/user-attachments/assets/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const ZIP_URL = 'https://github.com/user-attachments/files/123/media.zip'

let root: string
let contentRoot: string
let publicRoot: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'issue-content-'))
  contentRoot = join(root, 'content')
  publicRoot = join(root, 'public')
  const dir = join(contentRoot, 'routes', 'demo')
  mkdirSync(join(dir, 'stops'), { recursive: true })
  writeFileSync(
    join(dir, 'tour.yaml'),
    [
      'route_name: "Demo"',
      'subtitle: "Sub"',
      'description: "Desc"',
      'icon: "🚩"',
      'total_distance: "1 km"',
      'duration: "20 min"',
      'map:',
      '  basemap: "/tours/demo/demo.pmtiles"  # local PMTiles raster basemap',
      '  center: [-0.38, 50.86]',
      '  zoom: 14',
      'stops:',
      '  - "alpha"',
      '  - "beta"',
      '',
    ].join('\n')
  )
  writeFileSync(
    join(dir, 'stops', 'alpha.md'),
    '---\nid: alpha\ntitle: "Alpha"\nlat: 50.857\nlng: -0.378\nproximity_radius: 40\nera: Iron Age\nevidence: |\n  Alpha evidence.\ninterpretation: |\n  Alpha interp.\n---\n\n# Alpha\n\nAlpha body.\n'
  )
  // numbered-prefix convention
  writeFileSync(
    join(dir, 'stops', '02-beta.md'),
    '---\nid: beta\ntitle: "Beta"\nlat: 50.858\nlng: -0.379\nevidence: Beta evidence.\n---\n\nBeta body.\n'
  )
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const opts = (remote: Remote = {}) => ({ contentRoot, publicRoot, fetchFn: fetchOf(remote) })
const stopFields = (extra: Record<string, string> = {}) => ({
  [LABELS.tour]: 'demo',
  [LABELS.stopTitle]: 'Gamma Gate',
  [LABELS.stopId]: '',
  [LABELS.after]: '',
  [LABELS.lat]: '50.8590',
  [LABELS.lng]: '-0.3800',
  [LABELS.radius]: '',
  [LABELS.era]: '',
  [LABELS.gridRef]: '',
  [LABELS.elevation]: '',
  [LABELS.walkTime]: '',
  [LABELS.evidence]: 'A gate.',
  [LABELS.interpretation]: '',
  [LABELS.body]: 'The gate story.',
  [LABELS.hero]: '',
  [LABELS.photos]: '',
  [LABELS.extras]: '',
  ...extra,
})

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe('parseIssueForm / detectKind', () => {
  it('splits on known headings and maps _No response_ to empty', () => {
    const f: Record<string, string> = parseIssueForm(body({ [LABELS.routeName]: 'Hill', [LABELS.subtitle]: '' }))
    expect(f[LABELS.routeName]).toBe('Hill')
    expect(f[LABELS.subtitle]).toBe('')
  })

  it('keeps multiline values and handles CRLF', () => {
    const raw = body({ [LABELS.evidence]: 'line one\n\nline two', [LABELS.body]: 'b' }).replace(/\n/g, '\r\n')
    const f: Record<string, string> = parseIssueForm(raw)
    expect(f[LABELS.evidence]).toBe('line one\n\nline two')
    expect(f[LABELS.body]).toBe('b')
  })

  it('does not split on a ### subheading inside a stop body', () => {
    const f: Record<string, string> = parseIssueForm(body({ [LABELS.body]: 'intro\n\n### Viewshed\n\nThe channel.', [LABELS.hero]: '' }))
    expect(f[LABELS.body]).toBe('intro\n\n### Viewshed\n\nThe channel.')
  })

  it('detects the three forms from their distinctive headings', () => {
    expect(detectKind(parseIssueForm(body({ [LABELS.routeName]: 'x', [LABELS.stopTitle]: 'y' })))).toBe('new-tour')
    expect(detectKind(parseIssueForm(body({ [LABELS.stopTitle]: 'y', [LABELS.after]: '' })))).toBe('add-stop')
    expect(detectKind(parseIssueForm(body({ [LABELS.stopId]: 'y', [LABELS.del]: '- [ ] Delete this stop' })))).toBe('edit-stop')
    expect(detectKind({})).toBeNull()
  })
})

describe('coordinates', () => {
  it('parses separate fields and rounds to 6 dp', () => {
    expect(parseCoordinates('50.85701234', '-0.3780')).toEqual({ lat: 50.857012, lng: -0.378, errors: [] })
  })
  it('accepts a pasted pair in the latitude field', () => {
    expect(parseCoordinates('50.857, -0.378', '')).toMatchObject({ lat: 50.857, lng: -0.378, errors: [] })
    expect(parseCoordinates('(50.857 -0.378)', '')).toMatchObject({ lat: 50.857, lng: -0.378 })
  })
  it('rejects missing, non-numeric and out-of-range values', () => {
    expect(parseCoordinates('', '').errors).toHaveLength(2)
    expect(parseCoordinates('abc', '1').errors[0]).toMatch(/not a number/)
    expect(parseCoordinates('91', '0').errors[0]).toMatch(/out of range/)
    expect(parseCoordinates('0', '-181').errors[0]).toMatch(/out of range/)
  })
  it('warns (without rejecting) when far from the tour and suggests the swap', () => {
    const others = [{ lat: 50.857, lng: -0.378 }]
    expect(coordWarnings({ lat: 50.8575, lng: -0.3785 }, others)).toEqual([])
    const w = coordWarnings({ lat: -0.378, lng: 50.857 }, others)
    expect(w[0]).toMatch(/swapped/i)
    expect(coordWarnings({ lat: 10, lng: 10 }, [])).toEqual([])
  })
})

describe('media references', () => {
  it('finds markdown images, <img> tags, file links and bare asset URLs', () => {
    const text = [
      `![gate](${ASSET})`,
      `<img width="300" alt="Ramparts" src="${ASSET2}">`,
      `[media.zip](${ZIP_URL})`,
      'https://github.com/user-attachments/assets/99999999-0000-0000-0000-000000000000',
    ].join('\n\n')
    const refs = findRefs(text)
    expect(refs.map((r) => r.url)).toEqual([ASSET, ASSET2, ZIP_URL, 'https://github.com/user-attachments/assets/99999999-0000-0000-0000-000000000000'])
    expect(refs[0].alt).toBe('gate')
    expect(refs[1].alt).toBe('Ramparts')
  })
  it('treats GitHub default alt text as no caption', () => {
    expect(findRefs(`![image](${ASSET})`)[0].alt).toBe('')
    expect(findRefs(`![IMG_1234](${ASSET})`)[0].alt).toBe('')
  })
  it('takes captions from alt text, `url | caption`, or the following plain line', () => {
    const items = parseMediaField(
      [`![Rampart](${ASSET})`, `${ASSET2}`, 'Seen from the south', 'https://example.com/a.mp3 | Skylark'].join('\n')
    )
    expect(items).toEqual([
      { url: ASSET, caption: 'Rampart' },
      { url: ASSET2, caption: 'Seen from the south' },
      { url: 'https://example.com/a.mp3', caption: 'Skylark' },
    ])
  })
  it('sniffs the real type from the bytes', () => {
    expect([PNG, JPG, GIF, MP4, MP3, GLB, zipOf({ 'a.png': PNG })].map(sniffExt)).toEqual(['png', 'jpg', 'gif', 'mp4', 'mp3', 'glb', 'zip'])
    expect(sniffExt(Buffer.alloc(30))).toBeNull()
  })
})

describe('editStopList', () => {
  const base = 'a: 1\n# keep me\nstops:\n  - "x"\n  - y # note\nafter: z\n'
  it('appends, inserts and removes without touching comments', () => {
    expect(editStopList(base, { insert: { id: 'n', afterId: '' } })).toBe('a: 1\n# keep me\nstops:\n  - "x"\n  - y # note\n  - "n"\nafter: z\n')
    expect(editStopList(base, { insert: { id: 'n', afterId: 'x' } })).toContain('  - "x"\n  - "n"\n  - y # note')
    expect(editStopList(base, { insert: { id: 'n', afterId: 'start' } })).toContain('stops:\n  - "n"\n  - "x"')
    expect(editStopList(base, { remove: 'x' })).toBe('a: 1\n# keep me\nstops:\n  - y # note\nafter: z\n')
  })
  it('converts an inline list and errors on unknown ids', () => {
    expect(yaml.load(editStopList('stops: [a, b]\n', { insert: { id: 'c', afterId: '' } }))).toEqual({ stops: ['a', 'b', 'c'] })
    expect(() => editStopList(base, { remove: 'nope' })).toThrow(/not in tour.yaml/)
    expect(() => editStopList(base, { insert: { id: 'n', afterId: 'nope' } })).toThrow(/not in tour.yaml/)
  })
})

// ---------------------------------------------------------------------------
// Planners
// ---------------------------------------------------------------------------

describe('planAddStop', () => {
  it('writes the stop, inserts the id at the end and passes the repo validators', async () => {
    const plan = await planAddStop(stopFields(), opts())
    expect(plan.errors).toEqual([])
    expect(plan.stopId).toBe('gamma-gate')
    applyPlan(plan)
    const fm = matter(readFileSync(join(contentRoot, 'routes/demo/stops/gamma-gate.md'), 'utf-8'), {})
    expect(fm.data).toMatchObject({ id: 'gamma-gate', title: 'Gamma Gate', lat: 50.859, lng: -0.38, proximity_radius: 30, evidence: 'A gate.' })
    expect(fm.data.era).toBeUndefined()
    expect(fm.content.trim()).toBe('The gate story.')
    const tour = readFileSync(join(contentRoot, 'routes/demo/tour.yaml'), 'utf-8')
    expect(tour).toContain('# local PMTiles raster basemap') // comments survive
    expect(yaml.load(tour)).toMatchObject({ stops: ['alpha', 'beta', 'gamma-gate'] })
    expect(() => validateGeneratedRoute(join(contentRoot, 'routes/demo'), publicRoot)).not.toThrow()
  })

  it('inserts after a named stop and accepts a pasted lat,lng pair', async () => {
    const plan = await planAddStop(stopFields({ [LABELS.after]: 'alpha', [LABELS.lat]: '50.859, -0.38', [LABELS.lng]: '' }), opts())
    expect(plan.errors).toEqual([])
    applyPlan(plan)
    expect(yaml.load(readFileSync(join(contentRoot, 'routes/demo/tour.yaml'), 'utf-8'))).toMatchObject({ stops: ['alpha', 'gamma-gate', 'beta'] })
  })

  it('collects every validation error and writes nothing', async () => {
    const plan = await planAddStop(
      stopFields({ [LABELS.stopTitle]: '', [LABELS.lat]: '120', [LABELS.evidence]: '', [LABELS.after]: 'zzz', [LABELS.radius]: '2' }),
      opts()
    )
    expect(plan.errors.join('\n')).toMatch(/Stop title/)
    expect(plan.errors.join('\n')).toMatch(/out of range/)
    expect(plan.errors.join('\n')).toMatch(/Evidence/)
    expect(plan.errors.join('\n')).toMatch(/Insert after stop id/)
    expect(plan.errors.join('\n')).toMatch(/Proximity radius/)
    expect(plan.writes).toEqual([])
  })

  it('rejects an unknown tour, a bad id and a duplicate id', async () => {
    expect((await planAddStop(stopFields({ [LABELS.tour]: 'nope' }), opts())).errors[0]).toMatch(/does not exist/)
    expect((await planAddStop(stopFields({ [LABELS.stopId]: 'Not A Slug' }), opts())).errors.join()).toMatch(/lowercase/)
    expect((await planAddStop(stopFields({ [LABELS.stopId]: 'alpha' }), opts())).errors.join()).toMatch(/already exists/)
  })

  it('warns when the stop is nowhere near the tour', async () => {
    const plan = await planAddStop(stopFields({ [LABELS.lat]: '-0.38', [LABELS.lng]: '50.859' }), opts())
    expect(plan.errors).toEqual([])
    expect(plan.warnings.join()).toMatch(/swapped/i)
  })
})

describe('media', () => {
  it('downloads body attachments, sniffing type from bytes, and rewrites them to local paths', async () => {
    const plan = await planAddStop(
      stopFields({ [LABELS.body]: `Intro\n\n![Rampart view](${ASSET})\n\n${ASSET2}\n\n### Sub\n\nmore` }),
      opts({ [ASSET]: { buf: PNG }, [ASSET2]: { buf: MP4, type: 'application/octet-stream' } })
    )
    expect(plan.errors).toEqual([])
    applyPlan(plan)
    const md = readFileSync(join(contentRoot, 'routes/demo/stops/gamma-gate.md'), 'utf-8')
    expect(md).toContain('![Rampart view](/tours/demo/gamma-gate-1.png)')
    expect(md).toContain('![](/tours/demo/gamma-gate-2.mp4)')
    expect(md).toContain('### Sub')
    expect(md).not.toContain('github.com')
    expect(existsSync(join(publicRoot, 'tours/demo/gamma-gate-1.png'))).toBe(true)
    expect(readFileSync(join(publicRoot, 'tours/demo/gamma-gate-2.mp4'))).toEqual(MP4)
  })

  it('maps each type to the right markdown (image/video/audio/3D) via the real renderer', async () => {
    const plan = await planAddStop(
      stopFields({
        [LABELS.photos]: `![Gate](${ASSET})`,
        [LABELS.extras]: 'https://example.com/lark.mp3 | Skylark\nhttps://example.com/fort.glb | Fort model\nhttps://example.com/pan.mp4',
      }),
      opts({
        [ASSET]: { buf: JPG },
        'https://example.com/lark.mp3': { buf: MP3 },
        'https://example.com/fort.glb': { buf: GLB },
        'https://example.com/pan.mp4': { buf: MP4 },
      })
    )
    expect(plan.errors).toEqual([])
    applyPlan(plan)
    const route = loadTourRoute(join(contentRoot, 'routes/demo'))
    const html = route.stops.find((s: { id: string }) => s.id === 'gamma-gate')!.bodyHtml
    expect(html).toContain('<img src="/tours/demo/gamma-gate-1.jpg" alt="Gate"')
    expect(html).toContain('media-audio')
    expect(html).toContain('media-model')
    expect(html).toContain('media-video')
    expect(html).toContain('<figcaption>Skylark</figcaption>')
  })

  it('places media at a {{media}} marker, else appends it', async () => {
    const remote = { [ASSET]: { buf: PNG } }
    const at = await planAddStop(stopFields({ [LABELS.body]: 'Top\n\n{{media}}\n\nBottom', [LABELS.photos]: `${ASSET}\nCaption` }), opts(remote))
    const atMd = String(at.writes.find((w: { path: string }) => w.path.endsWith('gamma-gate.md'))!.data)
    expect(atMd.indexOf('![Caption]')).toBeGreaterThan(atMd.indexOf('Top'))
    expect(atMd.indexOf('![Caption]')).toBeLessThan(atMd.indexOf('Bottom'))
    const end = await planAddStop(stopFields({ [LABELS.photos]: `${ASSET}\nCaption` }), opts(remote))
    expect(String(end.writes.find((w: { path: string }) => w.path.endsWith('gamma-gate.md'))!.data).trim().endsWith('![Caption](/tours/demo/gamma-gate-1.png)')).toBe(true)
  })

  it('unpacks a zip, skipping junk and unsupported files, captioning from filenames', async () => {
    const zip = zipOf({ 'skylark-song.mp3': MP3, 'fort.glb': GLB, '__MACOSX/x.mp3': MP3, '.hidden.png': PNG, 'notes.txt': Buffer.from('hello world!!') })
    const plan = await planAddStop(stopFields({ [LABELS.extras]: `[media.zip](${ZIP_URL})` }), opts({ [ZIP_URL]: { buf: zip } }))
    expect(plan.errors).toEqual([])
    const md = String(plan.writes.find((w: { path: string }) => w.path.endsWith('gamma-gate.md'))!.data)
    expect(md).toContain('![Fort](/tours/demo/gamma-gate-1.glb)')
    expect(md).toContain('![Skylark song](/tours/demo/gamma-gate-2.mp3)')
    expect(plan.writes.filter((w: { path: string }) => w.path.includes('public') || w.path.includes(publicRoot))).toHaveLength(2)
    expect(plan.warnings.join()).toMatch(/notes\.txt/)
  })

  it('rejects zips inline in the body, unsupported types, oversize files and failed downloads', async () => {
    const zip = await planAddStop(stopFields({ [LABELS.body]: `[m.zip](${ZIP_URL})` }), opts({ [ZIP_URL]: { buf: zipOf({ 'a.png': PNG }) } }))
    expect(zip.errors.join()).toMatch(/zip files go in/)
    const odd = await planAddStop(stopFields({ [LABELS.photos]: 'https://example.com/doc.pdf' }), opts({ 'https://example.com/doc.pdf': { buf: Buffer.from('%PDF-1.4 hello world') } }))
    expect(odd.errors.join()).toMatch(/not a supported media type/)
    const big = await planAddStop(stopFields({ [LABELS.photos]: ASSET }), opts({ [ASSET]: { buf: Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]) } }))
    expect(big.errors.join()).toMatch(/exceeds the 10 MB limit/)
    const gone = await planAddStop(stopFields({ [LABELS.photos]: ASSET }), opts({}))
    expect(gone.errors.join()).toMatch(/HTTP 404/)
    const http = await planAddStop(stopFields({ [LABELS.photos]: 'http://example.com/a.png' }), opts())
    expect(http.errors.join()).toMatch(/https/)
  })

  it('stores a hero as frontmatter and requires it to be an image', async () => {
    const ok = await planAddStop(stopFields({ [LABELS.hero]: `${ASSET}\nPanorama` }), opts({ [ASSET]: { buf: PNG } }))
    expect(ok.errors).toEqual([])
    const fm = matter(String(ok.writes.find((w: { path: string }) => w.path.endsWith('gamma-gate.md'))!.data), {})
    expect(fm.data.hero).toEqual({ src: '/tours/demo/gamma-gate-1.png', caption: 'Panorama' })
    const bad = await planAddStop(stopFields({ [LABELS.hero]: ASSET }), opts({ [ASSET]: { buf: MP4 } }))
    expect(bad.errors.join()).toMatch(/must be an image/)
  })
})

describe('planEditStop', () => {
  const edit = (extra: Record<string, string> = {}) => ({
    [LABELS.tour]: 'demo',
    [LABELS.stopId]: 'alpha',
    ...Object.fromEntries(
      [LABELS.stopTitle, LABELS.lat, LABELS.lng, LABELS.radius, LABELS.era, LABELS.gridRef, LABELS.elevation, LABELS.walkTime, LABELS.evidence, LABELS.interpretation, LABELS.body, LABELS.hero, LABELS.photos, LABELS.extras].map((k) => [k, ''])
    ),
    [LABELS.del]: '- [ ] Delete this stop',
    ...extra,
  })

  it('changes only the supplied fields', async () => {
    const plan = await planEditStop(edit({ [LABELS.stopTitle]: 'Alpha Prime', [LABELS.lat]: '50.9' }), opts())
    expect(plan.errors).toEqual([])
    applyPlan(plan)
    const fm = matter(readFileSync(join(contentRoot, 'routes/demo/stops/alpha.md'), 'utf-8'), {})
    expect(fm.data).toMatchObject({ title: 'Alpha Prime', lat: 50.9, lng: -0.378, proximity_radius: 40, era: 'Iron Age' })
    expect(fm.data.evidence.trim()).toBe('Alpha evidence.')
    expect(fm.content).toContain('Alpha body.')
  })

  it('"-" clears an optional field but not required ones', async () => {
    const plan = await planEditStop(edit({ [LABELS.era]: '-', [LABELS.interpretation]: '-' }), opts())
    applyPlan(plan)
    const fm = matter(readFileSync(join(contentRoot, 'routes/demo/stops/alpha.md'), 'utf-8'), {})
    expect(fm.data.era).toBeUndefined()
    expect(fm.data.interpretation).toBeUndefined()
    expect((await planEditStop(edit({ [LABELS.stopTitle]: '-' }), opts())).errors[0]).toMatch(/cannot be cleared/)
  })

  it('finds numbered-prefix files and appends new media to the existing body', async () => {
    const plan = await planEditStop(edit({ [LABELS.stopId]: 'beta', [LABELS.photos]: `${ASSET}\nNew view` }), opts({ [ASSET]: { buf: PNG } }))
    expect(plan.errors).toEqual([])
    expect(plan.writes.some((w: { path: string }) => w.path.endsWith('02-beta.md'))).toBe(true)
    applyPlan(plan)
    const md = readFileSync(join(contentRoot, 'routes/demo/stops/02-beta.md'), 'utf-8')
    expect(md).toContain('Beta body.')
    expect(md).toContain('![New view](/tours/demo/beta-1.png)')
  })

  it('does not overwrite media from an earlier submission', async () => {
    mkdirSync(join(publicRoot, 'tours/demo'), { recursive: true })
    writeFileSync(join(publicRoot, 'tours/demo/alpha-1.png'), PNG)
    const plan = await planEditStop(edit({ [LABELS.photos]: ASSET }), opts({ [ASSET]: { buf: JPG } }))
    expect(plan.writes.some((w: { path: string }) => w.path.endsWith('alpha-2.jpg'))).toBe(true)
  })

  it('replaces the whole body when Body is filled', async () => {
    const plan = await planEditStop(edit({ [LABELS.body]: 'Brand new.' }), opts())
    applyPlan(plan)
    expect(matter(readFileSync(join(contentRoot, 'routes/demo/stops/alpha.md'), 'utf-8'), {}).content.trim()).toBe('Brand new.')
  })

  it('deletes a stop (file + yaml entry) but never the last one', async () => {
    const plan = await planEditStop(edit({ [LABELS.del]: '- [x] Delete this stop' }), opts())
    expect(plan.errors).toEqual([])
    applyPlan(plan)
    expect(existsSync(join(contentRoot, 'routes/demo/stops/alpha.md'))).toBe(false)
    expect(yaml.load(readFileSync(join(contentRoot, 'routes/demo/tour.yaml'), 'utf-8'))).toMatchObject({ stops: ['beta'] })
    const last = await planEditStop(edit({ [LABELS.stopId]: 'beta', [LABELS.del]: '- [x] Delete this stop' }), opts())
    expect(last.errors[0]).toMatch(/only stop/)
  })

  it('rejects unknown stops and re-validates changed coordinates', async () => {
    expect((await planEditStop(edit({ [LABELS.stopId]: 'nope' }), opts())).errors[0]).toMatch(/not in `demo`/)
    expect((await planEditStop(edit({ [LABELS.lat]: '999' }), opts())).errors[0]).toMatch(/out of range/)
  })
})

describe('planNewTour', () => {
  const tour = (extra: Record<string, string> = {}) => ({
    [LABELS.routeName]: 'Chanctonbury Ring',
    [LABELS.tourId]: '',
    [LABELS.subtitle]: 'Beech clump',
    [LABELS.description]: 'A short walk.',
    [LABELS.icon]: '🌳',
    [LABELS.totalDistance]: '3 km',
    [LABELS.duration]: '1 h',
    [LABELS.stopTitle]: 'The Ring',
    [LABELS.lat]: '50.8847, -0.3908',
    [LABELS.lng]: '',
    [LABELS.evidence]: 'Beech trees.',
    [LABELS.body]: 'A ring of beeches.',
    [LABELS.photos]: '',
    [LABELS.extras]: '',
    ...extra,
  })

  it('creates a tour + first stop that load through the real content pipeline', async () => {
    const plan = await planNewTour(tour(), opts())
    expect(plan.errors).toEqual([])
    expect(plan.tourId).toBe('chanctonbury-ring')
    applyPlan(plan)
    const dir = join(contentRoot, 'routes/chanctonbury-ring')
    const text = readFileSync(join(dir, 'tour.yaml'), 'utf-8')
    expect(yaml.load(text)).toMatchObject({ route_name: 'Chanctonbury Ring', icon: '🌳', total_distance: '3 km', duration: '1 h', stops: ['the-ring'] })
    expect(text).toContain('# map:') // commented out: no .pmtiles yet
    expect(() => validateGeneratedRoute(dir, publicRoot)).not.toThrow()
    const route = loadTourRoute(dir)
    expect(route.stops[0]).toMatchObject({ id: 'the-ring', lat: 50.8847, lng: -0.3908 })
    expect(plan.warnings.join()).toMatch(/pmtiles/)
  })

  it('requires name, description and a valid first stop; refuses an existing id', async () => {
    const bad = await planNewTour(tour({ [LABELS.routeName]: '', [LABELS.description]: '', [LABELS.lat]: 'x' }), opts())
    expect(bad.errors.join()).toMatch(/Route name/)
    expect(bad.errors.join()).toMatch(/Description/)
    expect(bad.errors.join()).toMatch(/not a number/)
    expect(bad.writes).toEqual([])
    expect((await planNewTour(tour({ [LABELS.tourId]: 'demo' }), opts())).errors.join()).toMatch(/already exists/)
  })
})

describe('route validation scope', () => {
  it("an unrelated stop's missing hero must not block an edit to another stop", async () => {
    const alpha = join(contentRoot, 'routes/demo/stops/alpha.md')
    // alpha references a hero that doesn't exist on disk (like a gitignored demo hero)
    writeFileSync(alpha, readFileSync(alpha, 'utf-8').replace('proximity_radius: 40', 'proximity_radius: 40\nhero:\n  src: /tours/demo/missing.png\n  caption: x'))
    const dir = join(contentRoot, 'routes/demo')
    expect(() => validateGeneratedRoute(dir, publicRoot)).toThrow(/hero image is missing/)
    expect(() => validateGeneratedRoute(dir, publicRoot, { onlyStops: ['beta'] })).not.toThrow()
    expect(() => validateGeneratedRoute(dir, publicRoot, { onlyStops: ['alpha'] })).toThrow(/hero image is missing/)
  })
})

describe('planFromIssueBody', () => {
  it('dispatches on the body and rejects a blank issue', async () => {
    const add = await planFromIssueBody(body(stopFields()), opts())
    expect(add.kind).toBe('add-stop')
    expect(add.errors).toEqual([])
    const none = await planFromIssueBody('just a bug report', opts())
    expect(none.kind).toBeNull()
    expect(none.errors[0]).toMatch(/content forms/)
  })
})

// ---------------------------------------------------------------------------
// Templates stay in step with the code and the content
// ---------------------------------------------------------------------------

describe('issue templates', () => {
  const dir = join(process.cwd(), '.github', 'ISSUE_TEMPLATE')

  it('every template field label is one the parser knows', () => {
    const known = new Set(Object.values(LABELS))
    for (const f of readdirSync(dir).filter((n) => n !== 'config.yml')) {
      const t = yaml.load(readFileSync(join(dir, f), 'utf-8')) as { body: { type: string; attributes?: { label?: string } }[] }
      for (const item of t.body) {
        if (item.type === 'markdown') continue
        expect(known.has(item.attributes!.label!), `${f}: unknown label "${item.attributes!.label}"`).toBe(true)
      }
    }
  })

  it('field labels are unique within each template (GitHub requires it)', () => {
    for (const f of readdirSync(dir).filter((n) => n !== 'config.yml')) {
      const t = yaml.load(readFileSync(join(dir, f), 'utf-8')) as { body: { type: string; attributes?: { label?: string } }[] }
      const labels = t.body.filter((i) => i.type !== 'markdown').map((i) => i.attributes!.label)
      expect(new Set(labels).size, f).toBe(labels.length)
    }
  })

  it('Tour dropdown options match content/routes — run `npm run content:sync-templates` if this fails', () => {
    const ids = listTourIds(join(process.cwd(), 'content'))
    expect(ids.length).toBeGreaterThan(0)
    for (const f of TEMPLATES_WITH_TOUR_DROPDOWN) {
      const text = readFileSync(join(dir, f), 'utf-8')
      expect(renderTemplate(text, ids), `${f} is out of date`).toBe(text)
    }
  })

  it('the workflow triggers on each template title prefix', () => {
    const wf = readFileSync(join(process.cwd(), '.github', 'workflows', 'content-from-issue.yml'), 'utf-8')
    for (const f of readdirSync(dir).filter((n) => n !== 'config.yml')) {
      const t = yaml.load(readFileSync(join(dir, f), 'utf-8')) as { title: string }
      expect(wf, f).toContain(`'${t.title.trim()}'`)
    }
  })
})
