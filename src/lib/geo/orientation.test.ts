import { describe, it, expect, vi, afterEach } from 'vitest'
import { get } from 'svelte/store'
import {
  compassHeading,
  compassNeedsPermission,
  requestCompassPermission,
  compassGranted,
} from './orientation'

function fireOrientation(type: string, props: Record<string, unknown>) {
  const e = new Event(type)
  Object.assign(e, props)
  window.dispatchEvent(e)
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  compassGranted.set(false)
})

describe('compassHeading store', () => {
  it('is null until an orientation event arrives', () => {
    const unsub = compassHeading.subscribe(() => {})
    expect(get(compassHeading)).toBeNull()
    unsub()
  })

  it('derives heading from deviceorientationabsolute alpha (Android path)', () => {
    let value: number | null = null
    const unsub = compassHeading.subscribe((v) => (value = v))
    fireOrientation('deviceorientationabsolute', { absolute: true, alpha: 90 })
    expect(value).toBe(270) // (360 - alpha) % 360
    unsub()
  })

  it('ignores non-absolute orientation events', () => {
    let value: number | null = null
    const unsub = compassHeading.subscribe((v) => (value = v))
    fireOrientation('deviceorientationabsolute', { absolute: false, alpha: 90 })
    expect(value).toBeNull()
    unsub()
  })

  it('uses webkitCompassHeading when present (iOS path)', () => {
    let value: number | null = null
    const unsub = compassHeading.subscribe((v) => (value = v))
    fireOrientation('deviceorientation', { webkitCompassHeading: 123.4 })
    expect(value).toBe(123)
    unsub()
  })

  it('resets to null and stops listening after last unsubscribe', () => {
    let value: number | null = null
    const unsub = compassHeading.subscribe((v) => (value = v))
    fireOrientation('deviceorientationabsolute', { absolute: true, alpha: 0 })
    expect(value).toBe(0)
    unsub()

    // Re-subscribe: previous value must not leak
    const unsub2 = compassHeading.subscribe((v) => (value = v))
    expect(value).toBeNull()
    unsub2()
  })
})

describe('compass permission flow', () => {
  it('needs no permission when requestPermission is absent (Android/jsdom)', async () => {
    expect(compassNeedsPermission()).toBe(false)
    expect(await requestCompassPermission()).toBe(true)
    expect(get(compassGranted)).toBe(true)
  })

  it('requests and remembers an iOS grant', async () => {
    vi.stubGlobal('DeviceOrientationEvent', {
      requestPermission: vi.fn().mockResolvedValue('granted'),
    })
    expect(compassNeedsPermission()).toBe(true)
    expect(await requestCompassPermission()).toBe(true)
    expect(get(compassGranted)).toBe(true)
    expect(localStorage.getItem('fw-compass')).toBe('1')
  })

  it('returns false on denial and does not store a grant', async () => {
    vi.stubGlobal('DeviceOrientationEvent', {
      requestPermission: vi.fn().mockResolvedValue('denied'),
    })
    expect(await requestCompassPermission()).toBe(false)
    expect(get(compassGranted)).toBe(false)
    expect(localStorage.getItem('fw-compass')).toBeNull()
  })

  it('returns false (never throws) when the prompt requires a gesture', async () => {
    vi.stubGlobal('DeviceOrientationEvent', {
      requestPermission: vi.fn().mockRejectedValue(new Error('needs gesture')),
    })
    expect(await requestCompassPermission()).toBe(false)
  })
})
