import { describe, it, expect } from 'vitest'
import { workboxOptions, PMTILES_CACHE, TOUR_MEDIA_CACHE } from './workbox-config'

describe('workbox config', () => {
  it('never precaches tour media (it must be runtime-cached instead)', () => {
    expect(workboxOptions.globIgnores).toContain('tours/**')
  })

  it('serves pmtiles from a Range-request-aware CacheFirst rule', () => {
    const rule = workboxOptions.runtimeCaching.find((r) =>
      r.urlPattern.test('/tours/cissbury-ring/cissbury-tiles-3.pmtiles')
    )
    expect(rule).toBeDefined()
    expect(rule!.handler).toBe('CacheFirst')
    expect(rule!.options.cacheName).toBe(PMTILES_CACHE)
    expect(rule!.options.rangeRequests).toBe(true)
  })

  it('matches pmtiles with the pmtiles rule, not the generic tour-media rule', () => {
    // Order matters: the first matching rule wins in Workbox
    const url = '/tours/cissbury-ring/cissbury-tiles-3.pmtiles'
    const first = workboxOptions.runtimeCaching.find((r) => r.urlPattern.test(url))
    expect(first!.options.cacheName).toBe(PMTILES_CACHE)
  })

  it('runtime-caches other tour media', () => {
    const url = '/tours/cissbury-ring/rampart.png'
    const rule = workboxOptions.runtimeCaching.find((r) => r.urlPattern.test(url))
    expect(rule).toBeDefined()
    expect(rule!.options.cacheName).toBe(TOUR_MEDIA_CACHE)
  })
})
