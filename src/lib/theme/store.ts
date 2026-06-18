import { writable } from 'svelte/store'

export type Theme = 'light' | 'dark' | 'night'

/** Theme-color values written to the meta tag (for browser chrome tinting) */
const THEME_COLORS: Record<Theme, string> = {
  light: '#f3eede',
  dark: '#15160f',
  night: '#0c0603',
}

function getInitialTheme(): Theme {
  // SSR / test guard
  if (typeof window === 'undefined') return 'light'
  const stored = localStorage.getItem('fw-theme') as Theme | null
  if (stored === 'light' || stored === 'dark' || stored === 'night') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t)
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = THEME_COLORS[t]
  try { localStorage.setItem('fw-theme', t) } catch {}
}

function createThemeStore() {
  const initial = getInitialTheme()
  const { subscribe, update } = writable<Theme>(initial)

  // Apply immediately on creation (browser only)
  if (typeof document !== 'undefined') applyTheme(initial)

  return {
    subscribe,
    /** Cycle Light → Dark → Night → Light */
    cycle() {
      update((t) => {
        const next: Record<Theme, Theme> = { light: 'dark', dark: 'night', night: 'light' }
        const n = next[t]
        applyTheme(n)
        return n
      })
    },
    set(t: Theme) {
      applyTheme(t)
      update(() => t)
    },
  }
}

export const theme = createThemeStore()
