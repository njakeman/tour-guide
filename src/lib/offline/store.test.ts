import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isBasemapCached, cacheBasemap, basemapSize, online } from './store'
import { PMTILES_CACHE } from '../pwa/workbox-config'

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
