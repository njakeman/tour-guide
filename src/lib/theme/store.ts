import { writable } from 'svelte/store'

export type Theme = 'light' | 'dark' | 'night'

const STORAGE_KEY = 'fw-theme'

/** Theme-color values written to the meta tag (for browser chrome tinting) */
const THEME_COLORS: Record<Theme, string> = {
  light: '#f3eede',
  dark: '#15160f',
  night: '#0c0603',
}

function storedTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
    if (stored === 'light' || stored === 'dark' || stored === 'night') return stored
  } catch {}
  return null
}

function systemTheme(): Theme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getInitialTheme(): Theme {
  // SSR / test guard
  if (typeof window === 'undefined') return 'light'
  return storedTheme() ?? systemTheme()
}

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t)
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = THEME_COLORS[t]
}

/** Persisting marks the theme as an explicit user choice. */
function persistTheme(t: Theme) {
  try { localStorage.setItem(STORAGE_KEY, t) } catch {}
}

function createThemeStore() {
  const initial = getInitialTheme()
  const { subscribe, set: setValue, update } = writable<Theme>(initial)

  // Apply immediately on creation (browser only)
  if (typeof document !== 'undefined') applyTheme(initial)

  // Follow system light/dark changes until the user makes an explicit choice
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener?.('change', (e) => {
      if (storedTheme() !== null) return
      const t: Theme = e.matches ? 'dark' : 'light'
      applyTheme(t)
      setValue(t)
    })
  }

  return {
    subscribe,
    /** Cycle Light → Dark → Night → Light */
    cycle() {
      update((t) => {
        const next: Record<Theme, Theme> = { light: 'dark', dark: 'night', night: 'light' }
        const n = next[t]
        applyTheme(n)
        persistTheme(n)
        return n
      })
    },
    set(t: Theme) {
      applyTheme(t)
      persistTheme(t)
      setValue(t)
    },
  }
}

export const theme = createThemeStore()
