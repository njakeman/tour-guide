import { defineConfig } from 'vitest/config'
import { contentPlugin } from './src/lib/content/vite-plugin'

export default defineConfig({
  plugins: [contentPlugin()],
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx,js,jsx}'],
  },
})
