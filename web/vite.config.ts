import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const server = 'http://127.0.0.1:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      // Our own service worker in src/sw.ts, because it handles push as well as caching.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: {
        name: 'baby greens',
        short_name: 'baby greens',
        description: 'Track your sprouts and microgreens, with reminders.',
        theme_color: '#05e17a',
        background_color: '#dcfce7',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'] },
      // A service worker in dev too, so push can be tried without a production build.
      devOptions: { enabled: true, type: 'module', navigateFallback: 'index.html' },
    }),
  ],
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
