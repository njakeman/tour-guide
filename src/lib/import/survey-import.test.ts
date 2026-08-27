import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'
import matter from 'gray-matter'
import yaml from 'js-yaml'
import {
  readZipEntries,
  slugify,
  stopPosition,
  photosOf,
  buildImportPlan,
  writePlan,
  validateGeneratedRoute,
} from '../../../scripts/import-survey.mjs'

// ---------------------------------------------------------------------------
// Minimal in-memory zip builder — enough of the format for readZipEntries,
// including the "local header reports size 0" data-descriptor case that
// survey-export-zip-spec.md §1 warns real exports use (client-zip).
// ---------------------------------------------------------------------------

function u16(n: number) {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n)
  return b
}
function u32(n: number) {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}

type TestZipFile = { name: string; data: Buffer; method?: 0 | 8; dataDescriptor?: boolean }

function buildTestZip(files: TestZipFile[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const method = file.method ?? 0
    const nameBuf = Buffer.from(file.name, 'utf-8')
    const compressed = method === 8 ? zlib.deflateRawSync(file.data) : file.data
    const useDescriptor = Boolean(file.dataDescriptor)
    const flags = useDescriptor ? 0x0008 : 0x0000

    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(flags),
      u16(method),
      u16(0),
      u16(0),
      u32(useDescriptor ? 0 : 0), // crc32 — never validated by readZipEntries
      u32(useDescriptor ? 0 : compressed.length),
      u32(useDescriptor ? 0 : file.data.length),
      u16(nameBuf.length),
      u16(0),
    ])
    const localEntry = Buffer.concat([localHeader, nameBuf, compressed])
    localParts.push(localEntry)

    const centralHeader = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(flags),
      u16(method),
      u16(0),
      u16(0),
      u32(0),
      u32(compressed.length), // real sizes live only here (spec §1)
      u32(file.data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
    ])
    centralParts.push(Buffer.concat([centralHeader, nameBuf]))

    offset += localEntry.length
  }

  const localData = Buffer.concat(localParts)
  const centralDir = Buffer.concat(centralParts)
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(localData.length),
    u16(0),
  ])

  return Buffer.concat([localData, centralDir, eocd])
}

// ---------------------------------------------------------------------------

describe('readZipEntries', () => {
  it('reads a stored (uncompressed) entry', () => {
    const zip = buildTestZip([{ name: 'session.geojson', data: Buffer.from('{"hello":"world"}') }])
    const entries = readZipEntries(zip)
    expect(entries.get('session.geojson')?.toString('utf-8')).toBe('{"hello":"world"}')
  })

  it('reads a deflated entry', () => {
    const payload = Buffer.from('x'.repeat(500))
    const zip = buildTestZip([{ name: 'photos/a.jpg', data: payload, method: 8 }])
    const entries = readZipEntries(zip)
    expect(entries.get('photos/a.jpg')).toEqual(payload)
  })

  it('reads an entry whose local header reports size 0 (data-descriptor case)', () => {
    // client-zip writes entries this way (survey-export-zip-spec.md §1) — a
    // naive reader trusting the local header would read zero bytes here.
    const payload = Buffer.from('real content, not zero bytes')
    const zip = buildTestZip([{ name: 'session.geojson', data: payload, dataDescriptor: true }])
    const entries = readZipEntries(zip)
    expect(entries.get('session.geojson')).toEqual(payload)
  })

  it('reads multiple entries at correct offsets', () => {
    const zip = buildTestZip([
      { name: 'session.geojson', data: Buffer.from('one') },
      { name: 'photos/a.jpg', data: Buffer.from('two-two-two'), method: 8 },
      { name: 'photos/b.jpg', data: Buffer.from('three'), dataDescriptor: true },
    ])
    const entries = readZipEntries(zip)
    expect(entries.get('session.geojson')?.toString()).toBe('one')
    expect(entries.get('photos/a.jpg')?.toString()).toBe('two-two-two')
    expect(entries.get('photos/b.jpg')?.toString()).toBe('three')
  })

  it('throws on a buffer with no end-of-central-directory record', () => {
    expect(() => readZipEntries(Buffer.from('not a zip'))).toThrow(/end-of-central-directory/)
  })
})

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('The Entrance Causeway')).toBe('the-entrance-causeway')
  })

  it('strips accents and punctuation', () => {
    expect(slugify('Café — Testing!')).toBe('cafe-testing')
  })

  it('returns empty string for empty/non-latin input', () => {
    expect(slugify('')).toBe('')
    expect(slugify('   ')).toBe('')
  })

  it('caps length', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(60)
  })
})

describe('stopPosition', () => {
  it('Point: prefers properties.lat/lon', () => {
    const feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-0.1, 51.5] },
      properties: { lat: 51.6, lon: -0.2 },
    }
    expect(stopPosition(feature)).toEqual({ lat: 51.6, lng: -0.2 })
  })

  it('Point: falls back to geometry coordinates when properties are missing', () => {
    const feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-0.1, 51.5] },
      properties: {},
    }
    expect(stopPosition(feature)).toEqual({ lat: 51.5, lng: -0.1 })
  })

  it('LineString: uses the first coordinate, not properties', () => {
    const feature = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-0.118, 50.875],
          [-0.117, 50.876],
        ],
      },
      properties: { lat: 999, lon: 999 }, // must be ignored for LineStrings
    }
    expect(stopPosition(feature)).toEqual({ lat: 50.875, lng: -0.118 })
  })

  it('Polygon: uses properties.lat/lon (the exporter\'s own centroid)', () => {
    const feature = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [0, 2],
            [2, 2],
            [2, 0],
            [0, 0],
          ],
        ],
      },
      properties: { lat: 1.5, lon: 1.5 },
    }
    expect(stopPosition(feature)).toEqual({ lat: 1.5, lng: 1.5 })
  })

  it('Polygon: falls back to the ring mean when properties are null', () => {
    const feature = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [0, 2],
            [2, 2],
            [2, 0],
          ],
        ],
      },
      properties: { lat: null, lon: null },
    }
    expect(stopPosition(feature)).toEqual({ lat: 1, lng: 1 })
  })
})

describe('photosOf', () => {
  it('reads the modern photos[] array in order', () => {
    const properties = {
      photos: [
        { photo: 'a.jpg', ref_photo: null },
        { photo: 'b.jpg', ref_photo: null },
      ],
      photo: 'a.jpg',
    }
    expect(photosOf(properties)).toEqual(['a.jpg', 'b.jpg'])
  })

  it('falls back to the legacy photo string (sample.zip\'s shape)', () => {
    expect(photosOf({ photo: 'legacy.jpg' })).toEqual(['legacy.jpg'])
  })

  it('returns an empty array when there are no photos', () => {
    expect(photosOf({ photo: null, photos: [] })).toEqual([])
    expect(photosOf({})).toEqual([])
  })
})

describe('buildImportPlan + generated content', () => {
  function session(features: unknown[]) {
    return {
      type: 'FeatureCollection',
      survey_session: { id: '01J', name: 'Test Session', started_at: '2025-01-01T00:00:00.000Z', ended_at: null },
      features,
    }
  }

  it('throws on an empty feature collection', () => {
    expect(() => buildImportPlan(session([]), { id: 'x', routeName: 'X', subtitle: '' })).toThrow(/no features/)
  })

  it('uses ordinal titles/ids regardless of note text, and never collides', () => {
    const plan = buildImportPlan(
      session([
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { note: 'Gate' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { note: 'Gate' } },
      ]),
      { id: 'x', routeName: 'X', subtitle: '' }
    )
    expect(plan.stops.map((s: { slug: string }) => s.slug)).toEqual(['stop-1', 'stop-2'])
    const parsed = plan.stops.map((s: { markdownText: string }) => matter(s.markdownText).data.title)
    expect(parsed).toEqual(['Stop 1', 'Stop 2'])
  })

  it('reports every audio file as skipped, never copies it', () => {
    const plan = buildImportPlan(
      session([
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: { note: 'Has audio', audio: 'note.m4a' },
        },
      ]),
      { id: 'x', routeName: 'X', subtitle: '' }
    )
    expect(plan.audioSkipped).toEqual([{ stopTitle: 'Stop 1', zipName: 'audio/note.m4a' }])
    expect(plan.photoCopyPlan).toEqual([])
  })

  it('generates frontmatter that satisfies content.test.ts\'s invariants for hostile note text', () => {
    const hostileNote = 'Quote " colon: newline\nand a <script>alert(1)</script> tag'
    const plan = buildImportPlan(
      session([
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-0.14, 51.5] },
          properties: { note: hostileNote, photos: [{ photo: 'a.jpg', ref_photo: null }] },
        },
      ]),
      { id: 'hostile-tour', routeName: 'Hostile Tour', subtitle: '' }
    )

    const stop = plan.stops[0]
    // gray-matter parses the frontmatter with js-yaml internally — this
    // throws if the YAML we generated is malformed.
    const parsed = matter(stop.markdownText)

    expect(parsed.data.id).toBeTruthy()
    expect(parsed.data.title).toBeTruthy()
    expect(parsed.data.evidence).toBeTruthy()
    expect(typeof parsed.data.lat).toBe('number')
    expect(typeof parsed.data.lng).toBe('number')
    expect(parsed.content.trim().length).toBeGreaterThan(0)

    // the raw `<script>` from the note must never reach the body unescaped
    expect(parsed.content).not.toContain('<script>')
  })

  it('never emits a map: block that would fail the offline-manifest test (no basemap shipped)', () => {
    const plan = buildImportPlan(
      session([{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { note: 'A' } }]),
      { id: 'x', routeName: 'X', subtitle: '' }
    )
    const parsedYaml = yaml.load(plan.tourYamlText) as { map?: unknown }
    expect(parsedYaml.map).toBeUndefined()
    expect(plan.tourYamlText).toContain('# map:')
  })

  it('never emits a hero block — all photos go inline in the body instead', () => {
    const plan = buildImportPlan(
      session([
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: { note: 'Two photos', photos: [{ photo: 'a.jpg' }, { photo: 'b.jpg' }] },
        },
      ]),
      { id: 'x', routeName: 'X', subtitle: '' }
    )
    const parsed = matter(plan.stops[0].markdownText)
    expect(parsed.data.hero).toBeUndefined()
    expect(parsed.content).toContain('/tours/x/01-stop-1-1.jpg')
    expect(parsed.content).toContain('/tours/x/01-stop-1-2.jpg')
  })

  it('warns and marks the body when a stop has no photos, but still has a non-empty body', () => {
    const plan = buildImportPlan(
      session([{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { note: 'No photo' } }]),
      { id: 'x', routeName: 'X', subtitle: '' }
    )
    const parsed = matter(plan.stops[0].markdownText)
    expect(parsed.data.hero).toBeUndefined()
    expect(parsed.content).toContain('no photo was captured')
    expect(plan.warnings).toEqual(['Stop 1 has no photos — add one by hand.'])
  })

  it('puts the note in the body, not in evidence — evidence stays a plain TODO', () => {
    const plan = buildImportPlan(
      session([{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { note: 'Field note text' } }]),
      { id: 'x', routeName: 'X', subtitle: '' }
    )
    const parsed = matter(plan.stops[0].markdownText)
    expect(parsed.content).toContain('Field note text')
    expect(parsed.data.evidence).not.toContain('Field note text')
    expect(parsed.data.evidence).toBeTruthy()
  })

  it('falls back to a TODO body when there is no note, still satisfying the non-empty-body invariant', () => {
    const plan = buildImportPlan(
      session([{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }]),
      { id: 'x', routeName: 'X', subtitle: '' }
    )
    const parsed = matter(plan.stops[0].markdownText)
    expect(parsed.content.trim().length).toBeGreaterThan(0)
    expect(parsed.content).toContain('TODO — write the story of this stop.')
  })

  it('threads description through to tour.yaml, falling back to a TODO when empty', () => {
    const withDescription = buildImportPlan(
      session([{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }]),
      { id: 'x', routeName: 'X', subtitle: '', description: 'A short walk around the site.' }
    )
    expect((yaml.load(withDescription.tourYamlText) as { description?: string }).description).toBe(
      'A short walk around the site.'
    )

    const withoutDescription = buildImportPlan(
      session([{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }]),
      { id: 'x', routeName: 'X', subtitle: '' }
    )
    expect(withoutDescription.tourYamlText).toContain('TODO — write a 1-2 sentence description')
  })

  it('writes route.geojson only with 2+ located stops', () => {
    const one = buildImportPlan(
      session([{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { note: 'A' } }]),
      { id: 'x', routeName: 'X', subtitle: '' }
    )
    expect(one.routeGeojsonText).toBeNull()

    const two = buildImportPlan(
      session([
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { note: 'A' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { note: 'B' } },
      ]),
      { id: 'x', routeName: 'X', subtitle: '' }
    )
    expect(two.routeGeojsonText).not.toBeNull()
    const geo = JSON.parse(two.routeGeojsonText as string)
    expect(geo.geometry.type).toBe('LineString')
    expect(geo.geometry.coordinates.length).toBe(2)
  })
})

describe('writePlan + validateGeneratedRoute (round trip on disk)', () => {
  let tmpRoot: string

  afterEach(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('writes a route that validates cleanly end to end', () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'survey-import-test-'))
    const contentRoot = join(tmpRoot, 'content')
    const publicRoot = join(tmpRoot, 'public')

    const zip = buildTestZip([
      { name: 'photos/p1.jpg', data: Buffer.from('fake-jpeg-bytes-1') },
      { name: 'photos/p2.jpg', data: Buffer.from('fake-jpeg-bytes-2'), dataDescriptor: true },
    ])
    const zipEntries = readZipEntries(zip)

    const sessionObj = {
      type: 'FeatureCollection',
      survey_session: { id: '01J', name: 'Round Trip', started_at: '2025-01-01T00:00:00.000Z', ended_at: null },
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-0.14, 51.5] },
          properties: {
            note: 'First stop',
            photos: [
              { photo: 'p1.jpg', ref_photo: null },
              { photo: 'p2.jpg', ref_photo: null },
            ],
          },
        },
      ],
    }

    const plan = buildImportPlan(sessionObj, { id: 'round-trip-tour', routeName: 'Round Trip Tour', subtitle: '' })
    const { routeDir, mediaBytes } = writePlan(plan, zipEntries, {
      contentRoot,
      publicRoot,
      sessionRaw: Buffer.from(JSON.stringify(sessionObj)),
    })

    expect(mediaBytes).toBeGreaterThan(0)
    expect(existsSync(join(routeDir, 'tour.yaml'))).toBe(true)
    expect(existsSync(join(routeDir, 'stops', '01-stop-1.md'))).toBe(true)
    expect(existsSync(join(publicRoot, 'tours', 'round-trip-tour', '01-stop-1-1.jpg'))).toBe(true)
    expect(existsSync(join(publicRoot, 'tours', 'round-trip-tour', '01-stop-1-2.jpg'))).toBe(true)

    expect(() => validateGeneratedRoute(routeDir, publicRoot)).not.toThrow()
  })

  it('throws when the zip is missing a photo the session.geojson references', () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'survey-import-test-'))
    const zipEntries = readZipEntries(buildTestZip([])) // no photos at all

    const sessionObj = {
      type: 'FeatureCollection',
      survey_session: { id: '01J', name: 'Missing Photo', started_at: '2025-01-01T00:00:00.000Z', ended_at: null },
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: { note: 'A', photos: [{ photo: 'missing.jpg', ref_photo: null }] },
        },
      ],
    }
    const plan = buildImportPlan(sessionObj, { id: 'missing-photo-tour', routeName: 'X', subtitle: '' })

    expect(() =>
      writePlan(plan, zipEntries, {
        contentRoot: join(tmpRoot, 'content'),
        publicRoot: join(tmpRoot, 'public'),
      })
    ).toThrow(/missing a file/)
  })
})
