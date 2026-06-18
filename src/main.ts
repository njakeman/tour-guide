import { mount } from 'svelte'
import './styles/brand.css'
import './app.css'
import '@fontsource/spectral/400.css'
import '@fontsource/spectral/400-italic.css'
import '@fontsource/spectral/600.css'
import '@fontsource/spectral/700.css'
import '@fontsource/hanken-grotesk/400.css'
import '@fontsource/hanken-grotesk/500.css'
import '@fontsource/hanken-grotesk/600.css'
import '@fontsource/hanken-grotesk/700.css'
import '@fontsource/hanken-grotesk/800.css'
import '@fontsource/spline-sans-mono/400.css'
import '@fontsource/spline-sans-mono/500.css'
import '@fontsource/spline-sans-mono/600.css'
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
