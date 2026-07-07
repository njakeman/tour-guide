import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'
import { contentPlugin } from './src/lib/content/vite-plugin'
import { workboxOptions } from './src/lib/pwa/workbox-config'

// Set BASE_PATH env var when serving from a sub-path (e.g. GitHub Pages):
//   BASE_PATH=/tour-guide/ npm run build
// Root-serving hosts (Netlify, Vercel) need no override.
const base = process.env.BASE_PATH ?? '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    contentPlugin(),
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      // devOptions: { enabled: true }, // uncomment to test SW in dev
      manifest: {
        name: 'fieldWorks',
        short_name: 'fieldWorks',
        description: 'A handheld field guide — hillforts, henges and barrows, offline in any light.',
        theme_color: '#f3eede',
        background_color: '#f3eede',
        display: 'standalone',
        orientation: 'portrait',
        // Derived from the build base so sub-path deploys stay installable.
        scope: base,
        start_url: base,
        icons: [
          {
            // Relative (no leading slash) so vite-plugin-pwa resolves against
            // the manifest's own URL, which already includes the base path.
            src: 'icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // Precache + runtime caching rules live in src/lib/pwa/workbox-config.ts,
      // shared with the runtime offline helpers so cache names cannot drift.
      workbox: workboxOptions,
    }),
  ],
})
