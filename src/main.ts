import { mount } from 'svelte'
import './styles/brand.css'
import './app.css'
// Latin subsets only — the full imports pull Cyrillic/Vietnamese/latin-ext
// files into the bundle and the SW precache for glyphs that never render.
// Spectral ships 600 only: every --font-serif rule sets font-weight 600.
import '@fontsource/spectral/latin-600.css'
import '@fontsource/hanken-grotesk/latin-400.css'
import '@fontsource/hanken-grotesk/latin-500.css'
import '@fontsource/hanken-grotesk/latin-600.css'
import '@fontsource/hanken-grotesk/latin-700.css'
import '@fontsource/hanken-grotesk/latin-800.css'
import '@fontsource/spline-sans-mono/latin-400.css'
import '@fontsource/spline-sans-mono/latin-500.css'
import '@fontsource/spline-sans-mono/latin-600.css'
import { registerSW } from 'virtual:pwa-register'
import App from './App.svelte'

// Register service worker — handled by vite-plugin-pwa
registerSW({
  immediate: true,
  onOfflineReady() {
    console.log('[PWA] App ready to work offline')
  },
})

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
