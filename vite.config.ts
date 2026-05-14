import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { contentPlugin } from './src/lib/content/vite-plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [contentPlugin(), svelte()],
})
