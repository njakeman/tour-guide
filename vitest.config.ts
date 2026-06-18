import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { contentPlugin } from './src/lib/content/vite-plugin'

export default defineConfig({
  plugins: [contentPlugin(), svelte({ hot: !process.env.VITEST })],
  test: {
    // jsdom for DOM APIs and component tests; geo store tests are also
    // compatible because navigator is present in jsdom
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx,js,jsx}'],
    globals: true,
  },
})
