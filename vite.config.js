import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages project site: https://syfazel.github.io/sclack-a/
// Hash routing (#/room/...) makes refresh work with a single index.html.
export default defineConfig({
  base: '/sclack-a/',
  plugins: [tailwindcss(), svelte()]
})
