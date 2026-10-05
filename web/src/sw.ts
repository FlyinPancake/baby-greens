/// <reference lib="webworker" />
// The service worker: precaches the app so it opens offline, and shows reminders that arrive
// by push. vite-plugin-pwa builds it and fills in __WB_MANIFEST.

import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[]
}

// A new version takes over right away, so the next page load runs it.
void self.skipWaiting()
clientsClaim()

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Page loads get the cached app shell when offline. The dev server has no precached
// index.html, and the API and login routes always go to the network.
if (import.meta.env.PROD) {
  registerRoute(
    new NavigationRoute(createHandlerBoundToURL('index.html'), {
      denylist: [/^\/api\//, /^\/auth\//],
    }),
  )
}

/** The JSON the server's reminder job sends. */
type Reminder = { title?: string; body?: string; url?: string; tag?: string }

self.addEventListener('push', (event) => {
  const reminder: Reminder = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(reminder.title ?? 'baby-greens', {
      body: reminder.body,
      tag: reminder.tag,
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
      data: { url: reminder.url ?? '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows.find((client) => client.url.startsWith(self.location.origin))
      if (open) {
        await open.focus()
        try {
          await open.navigate(url)
          return
        } catch {
          // An uncontrolled window can't be navigated from here. Open a new one instead.
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
