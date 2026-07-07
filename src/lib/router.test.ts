import { describe, it, expect } from 'vitest'
import { parseHash, buildHash } from './router'

describe('parseHash', () => {
  it('parses the library hash', () => {
    expect(parseHash('#/')).toEqual({ view: 'library' })
    expect(parseHash('')).toEqual({ view: 'library' })
  })

  it('parses the route hash', () => {
    expect(parseHash('#/route')).toEqual({ view: 'route' })
  })

  it('parses a stop hash with route', () => {
    expect(parseHash('#stop=cissbury-summit&route=cissbury-ring')).toEqual({
      view: 'stop',
      stopId: 'cissbury-summit',
      routeId: 'cissbury-ring',
    })
  })

  it('parses a stop hash without route', () => {
    expect(parseHash('#stop=cissbury-summit')).toEqual({
      view: 'stop',
      stopId: 'cissbury-summit',
      routeId: undefined,
    })
  })

  it('treats an empty stop id as undefined', () => {
    expect(parseHash('#stop=').stopId).toBeUndefined()
  })

  it('falls back to library for unknown hashes', () => {
    expect(parseHash('#/nonsense').view).toBe('library')
    expect(parseHash('#foo=bar').view).toBe('library')
  })
})

describe('buildHash', () => {
  it('builds each view', () => {
    expect(buildHash('library')).toBe('#/')
    expect(buildHash('route')).toBe('#/route')
    expect(buildHash('stop', 'a', 'r')).toBe('#stop=a&route=r')
  })

  it('falls back to library when stop view has no stop id', () => {
    expect(buildHash('stop')).toBe('#/')
  })

  it('round-trips through parseHash', () => {
    const built = buildHash('stop', 'my-stop', 'my-route')
    expect(parseHash(built)).toEqual({
      view: 'stop',
      stopId: 'my-stop',
      routeId: 'my-route',
    })
  })
})
