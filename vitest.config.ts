import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { contentPlugin } from './src/lib/content/vite-plugin'

export default defineConfig({
  // svelteTesting() resolves the browser (not server) build of Svelte 5 in
  // tests so component mounting works, and auto-cleans up between tests.
  plugins: [contentPlugin(), svelte({ hot: !process.env.VITEST }), svelteTesting()],
  test: {
    // jsdom for DOM APIs and component tests; geo store tests are also
    // compatible because navigator is present in jsdom
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx,js,jsx}'],
    globals: true,
  },
})
