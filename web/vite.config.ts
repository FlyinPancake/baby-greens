import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const server = 'http://127.0.0.1:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // The Dex redirect URI in dev/dex.yaml expects this port.
    port: 5173,
    strictPort: true,
    // Playwright writes into these while tests run. A change there must not reload open pages.
    watch: { ignored: ['**/e2e/**', '**/test-results/**', '**/playwright-report/**'] },
    // Proxying keeps the API on the same origin as the app, so session cookies work in dev.
    proxy: {
      '/api': server,
      '/auth': server,
    },
  },
})
