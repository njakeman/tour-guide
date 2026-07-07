import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { get } from 'svelte/store'
import { theme, type Theme } from './store'

// The <html data-theme> and theme-color meta are written by applyTheme; the
// meta only updates if it exists, so inject one for the duration of the suite.
let meta: HTMLMetaElement

beforeAll(() => {
  meta = document.createElement('meta')
  meta.setAttribute('name', 'theme-color')
  document.head.appendChild(meta)
})

afterAll(() => {
  meta.remove()
  theme.set('light') // leave the shared jsdom document in a known state
})

afterEach(() => {
  try { localStorage.clear() } catch {}
})

describe('theme cycle', () => {
  it('cycles light → dark → night → light', () => {
    theme.set('light')
    theme.cycle()
    expect(get(theme)).toBe('dark')
    theme.cycle()
    expect(get(theme)).toBe('night')
    theme.cycle()
    expect(get(theme)).toBe('light')
  })
})

describe('applyTheme side effects', () => {
  it('writes the data-theme attribute on <html>', () => {
    theme.set('night')
    expect(document.documentElement.getAttribute('data-theme')).toBe('night')
    theme.set('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('updates the theme-color meta tag per theme', () => {
    theme.set('light')
    expect(meta.content).toBe('#f3eede')
    theme.set('dark')
    expect(meta.content).toBe('#15160f')
    theme.set('night')
    expect(meta.content).toBe('#0c0603')
  })
})

describe('explicit choice persistence', () => {
  it('persists an explicit set to localStorage', () => {
    theme.set('night')
    expect(localStorage.getItem('fw-theme')).toBe('night')
  })

  it('persists on cycle too (a cycle is a user action)', () => {
    theme.set('light')
    theme.cycle()
    expect(localStorage.getItem('fw-theme')).toBe('dark')
  })
})

describe('THEME_COLORS ↔ brand.css --bg (drift guard)', () => {
  // THEME_COLORS in store.ts feeds the browser-chrome meta tag and must track
  // each theme's --bg background token in brand.css. The meta assertions above
  // pin the store side; these pin the CSS side, so a change to one without the
  // other fails here.
  const css = readFileSync(resolve('src/styles/brand.css'), 'utf-8')
  const expected: Record<Theme, string> = {
    light: '#f3eede',
    dark: '#15160f',
    night: '#0c0603',
  }

  for (const [name, hex] of Object.entries(expected)) {
    it(`brand.css declares --bg: ${hex} (for ${name})`, () => {
      expect(css).toMatch(new RegExp(`--bg:\\s*${hex}\\b`, 'i'))
    })
  }
})
