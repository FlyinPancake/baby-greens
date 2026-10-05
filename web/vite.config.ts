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
    // Tailnet mode (`mise run dev:tailnet`) sets these to reach the dev server from a phone.
    host: process.env.VITE_HOST ?? 'localhost',
    allowedHosts: process.env.VITE_ALLOWED_HOSTS?.split(',') ?? [],
    // PUBLIC_URL and the Dex redirect URI expect this port.
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
