import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isBasemapCached,
  cacheBasemap,
  basemapSize,
  online,
  tourOfflineBytes,
  fmtBytes,
  isTourCached,
  cacheTourOffline,
} from './store'
import { PMTILES_CACHE, TOUR_MEDIA_CACHE } from '../pwa/workbox-config'
import type { TourRoute } from '../types'

const URL = '/tours/cissbury-ring/cissbury.pmtiles'

/** Build a fake CacheStorage whose single cache has the given match/add. */
function stubCaches(cache: { match?: unknown; add?: unknown }) {
  const c = {
    match: cache.match ?? vi.fn().mockResolvedValue(undefined),
    add: cache.add ?? vi.fn().mockResolvedValue(undefined),
  }
  const open = vi.fn().mockResolvedValue(c)
  vi.stubGlobal('caches', { open })
  return { open, cache: c }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('isBasemapCached', () => {
  it('returns true when the basemap is in the cache', async () => {
    stubCaches({ match: vi.fn().mockResolvedValue(new Response('x')) })
    expect(await isBasemapCached(URL)).toBe(true)
  })

  it('returns false when the basemap is not cached', async () => {
    stubCaches({ match: vi.fn().mockResolvedValue(undefined) })
    expect(await isBasemapCached(URL)).toBe(false)
  })

  it('returns false when the Cache API is unavailable', async () => {
    vi.stubGlobal('caches', undefined)
    expect(await isBasemapCached(URL)).toBe(false)
  })

  it('returns false (never throws) when the cache lookup rejects', async () => {
    vi.stubGlobal('caches', { open: vi.fn().mockRejectedValue(new Error('boom')) })
    expect(await isBasemapCached(URL)).toBe(false)
  })
})

describe('cacheBasemap', () => {
  it('throws when the Cache API is unavailable', async () => {
    vi.stubGlobal('caches', undefined)
    await expect(cacheBasemap(URL)).rejects.toThrow('Cache API unavailable')
  })

  it('warms the cache with a full-file add when not already cached', async () => {
    const { open, cache } = stubCaches({ match: vi.fn().mockResolvedValue(undefined) })
    await cacheBasemap(URL)
    expect(open).toHaveBeenCalledWith(PMTILES_CACHE)
    expect(cache.add).toHaveBeenCalledWith(URL)
  })

  it('short-circuits (no add) when the basemap is already cached', async () => {
    const { cache } = stubCaches({ match: vi.fn().mockResolvedValue(new Response('x')) })
    await cacheBasemap(URL)
    expect(cache.add).not.toHaveBeenCalled()
  })
})

describe('basemapSize', () => {
  it('returns the content-length from a HEAD request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, { status: 200, headers: { 'content-length': '2048' } }),
      ),
    )
    expect(await basemapSize(URL)).toBe(2048)
  })

  it('returns null when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
    expect(await basemapSize(URL)).toBeNull()
  })

  it('returns null (never throws) when the fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await basemapSize(URL)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Full-tour warm-up — needs a name-keyed fake CacheStorage (media and pmtiles
// live in different caches), unlike stubCaches above.
// ---------------------------------------------------------------------------
type FakeCache = {
  store: Set<string>
  match: (url: string) => Promise<Response | undefined>
  add: ReturnType<typeof vi.fn>
}

let cachesByName: Map<string, FakeCache>
let failAddFor: Set<string>

function makeFakeCache(): FakeCache {
  const store = new Set<string>()
  return {
    store,
    match: async (url: string) => (store.has(url) ? new Response('x') : undefined),
    add: vi.fn(async (url: string) => {
      if (failAddFor.has(url)) throw new TypeError(`fetch failed: ${url}`)
      store.add(url)
    }),
  }
}

function stubMultiCaches() {
  cachesByName = new Map()
  failAddFor = new Set()
  vi.stubGlobal('caches', {
    open: async (name: string) => {
      if (!cachesByName.has(name)) cachesByName.set(name, makeFakeCache())
      return cachesByName.get(name)!
    },
  })
}

function seedCache(name: string, urls: string[]) {
  const cache = makeFakeCache()
  for (const u of urls) cache.store.add(u)
  cachesByName.set(name, cache)
}

function makeTourRoute(overrides: Partial<TourRoute> = {}): TourRoute {
  return {
    id: 'r',
    name: 'Route',
    description: 'd',
    icon: '🗺️',
    stops: [],
    map: { basemap: '/tours/r/r.pmtiles' },
    offline: {
      mediaUrls: ['/tours/r/a.webp', '/tours/r/b.mp3'],
      mediaBytes: 3_000_000,
      basemapBytes: 5_000_000,
    },
    ...overrides,
  }
}

describe('tourOfflineBytes / fmtBytes', () => {
  it('sums media and basemap bytes; 0 without a manifest', () => {
    expect(tourOfflineBytes(makeTourRoute())).toBe(8_000_000)
    expect(tourOfflineBytes(makeTourRoute({ offline: undefined }))).toBe(0)
  })

  it('formats MB and KB with a 1-unit floor', () => {
    expect(fmtBytes(8_000_000)).toBe('8 MB')
    expect(fmtBytes(850_000)).toBe('850 KB')
    expect(fmtBytes(120)).toBe('1 KB')
  })
})

describe('isTourCached', () => {
  beforeEach(stubMultiCaches)

  it('is false when the basemap is missing', async () => {
    seedCache(TOUR_MEDIA_CACHE, ['/tours/r/a.webp', '/tours/r/b.mp3'])
    expect(await isTourCached(makeTourRoute())).toBe(false)
  })

  it('is false when any media URL is missing', async () => {
    seedCache(PMTILES_CACHE, ['/tours/r/r.pmtiles'])
    seedCache(TOUR_MEDIA_CACHE, ['/tours/r/a.webp'])
    expect(await isTourCached(makeTourRoute())).toBe(false)
  })

  it('is true when the basemap and every media URL are cached', async () => {
    seedCache(PMTILES_CACHE, ['/tours/r/r.pmtiles'])
    seedCache(TOUR_MEDIA_CACHE, ['/tours/r/a.webp', '/tours/r/b.mp3'])
    expect(await isTourCached(makeTourRoute())).toBe(true)
  })

  it('needs only the basemap when there is no media manifest', async () => {
    seedCache(PMTILES_CACHE, ['/tours/r/r.pmtiles'])
    expect(await isTourCached(makeTourRoute({ offline: undefined }))).toBe(true)
  })
})

describe('cacheTourOffline', () => {
  beforeEach(stubMultiCaches)

  it('adds media then the basemap, reporting file-count progress', async () => {
    const progress: [number, number][] = []
    await cacheTourOffline(makeTourRoute(), (done, total) => progress.push([done, total]))

    expect([...cachesByName.get(TOUR_MEDIA_CACHE)!.store]).toEqual([
      '/tours/r/a.webp',
      '/tours/r/b.mp3',
    ])
    expect([...cachesByName.get(PMTILES_CACHE)!.store]).toEqual(['/tours/r/r.pmtiles'])
    expect(progress).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]])
  })

  it('skips media that is already cached', async () => {
    seedCache(TOUR_MEDIA_CACHE, ['/tours/r/a.webp'])
    await cacheTourOffline(makeTourRoute())
    const cache = cachesByName.get(TOUR_MEDIA_CACHE)!
    expect(cache.add).toHaveBeenCalledTimes(1)
    expect(cache.add).toHaveBeenCalledWith('/tours/r/b.mp3')
  })

  it('rejects when a media fetch fails, leaving earlier entries cached', async () => {
    failAddFor.add('/tours/r/b.mp3')
    await expect(cacheTourOffline(makeTourRoute())).rejects.toThrow('fetch failed')
    expect(cachesByName.get(TOUR_MEDIA_CACHE)!.store.has('/tours/r/a.webp')).toBe(true)
    // The basemap step never ran
    expect(cachesByName.get(PMTILES_CACHE)).toBeUndefined()
  })

  it('handles a route with a basemap but no media manifest', async () => {
    const progress: [number, number][] = []
    await cacheTourOffline(makeTourRoute({ offline: undefined }), (d, t) =>
      progress.push([d, t])
    )
    expect(progress).toEqual([[0, 1], [1, 1]])
    expect(cachesByName.get(PMTILES_CACHE)!.store.has('/tours/r/r.pmtiles')).toBe(true)
  })
})

describe('online store', () => {
  let value: boolean | undefined
  let unsub: () => void

  beforeEach(() => {
    value = undefined
    unsub = online.subscribe((v) => (value = v))
  })

  afterEach(() => unsub())

  it('exposes a boolean connectivity state', () => {
    expect(typeof value).toBe('boolean')
  })

  it('flips false on the window offline event and true on online', () => {
    window.dispatchEvent(new Event('offline'))
    expect(value).toBe(false)
    window.dispatchEvent(new Event('online'))
    expect(value).toBe(true)
  })
})
