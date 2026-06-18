import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'
import { contentPlugin } from './src/lib/content/vite-plugin'

// https://vite.dev/config/
export default defineConfig({
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
            src: '/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the app shell (JS/CSS/HTML) and web fonts
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
        // Runtime-cache tour media with a long-lived CacheFirst strategy
        runtimeCaching: [
          {
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
