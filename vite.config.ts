import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'
import { contentPlugin } from './src/lib/content/vite-plugin'

// https://vite.dev/config/
export default defineConfig({
  // Set BASE_PATH env var when serving from a sub-path (e.g. GitHub Pages):
  //   BASE_PATH=/tour-guide/ npm run build
  // Root-serving hosts (Netlify, Vercel) need no override.
  base: process.env.BASE_PATH ?? '/',
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
        scope: '/',
        start_url: '/',
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
      workbox: {
        // Precache the app shell (JS/CSS/HTML) and web fonts.
        // PMTiles basemaps are NOT precached here — they need Range-request-aware
        // caching (see runtimeCaching below). Precaching stores full 200 responses
        // which pmtiles rejects when it issues Range requests (it throws on 200+full).
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
        runtimeCaching: [
          {
            // PMTiles basemaps: CacheFirst with Range-request support.
            // pmtiles issues HTTP Range requests for each tile + header; Workbox's
            // rangeRequests plugin returns proper 206 Partial Content responses from
            // the cached full file, so offline rendering works after one online load.
            urlPattern: /\.pmtiles(\?.*)?$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pmtiles-basemaps',
              rangeRequests: true,
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
          {
            // Runtime-cache other tour media (images, audio, video) with CacheFirst
            urlPattern: /\/tours\/.+/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tour-media',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 60, // 60 days
              },
            },
          },
        ],
      },
    }),
  ],
})
