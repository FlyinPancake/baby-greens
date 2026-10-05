import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { createStore, del, get, set } from 'idb-keyval'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/space-grotesk'
import './index.css'
import { registerSW } from 'virtual:pwa-register'
import './lib/install'
import { setAfterSync, startOutbox } from './lib/outbox'
import './lib/theme'
import { routeTree } from './routeTree.gen'

/** How long cached data stays usable offline. */
const keepFor = 7 * 24 * 60 * 60 * 1000

const queryClient = new QueryClient({
  defaultOptions: {
    // Cached data has to outlive the persisted copy, or restoring it would drop it right away.
    queries: { gcTime: keepFor },
    // Fail right away when offline instead of waiting forever. Ticks and snoozes go through
    // the outbox instead, which does wait.
    mutations: { networkMode: 'always' },
  },
})

// The last loaded data, kept in IndexedDB so the app opens with it when offline.
const cacheStore = createStore('baby-greens-cache', 'queries')
const persister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => get(key, cacheStore),
    setItem: (key, value) => set(key, value, cacheStore),
    removeItem: (key) => del(key, cacheStore),
  },
})

const router = createRouter({ routeTree, context: { queryClient } })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

setAfterSync(() => void queryClient.invalidateQueries())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: keepFor,
        // Bump when cached data stops matching the API.
        buster: 'v1',
        dehydrateOptions: {
          // Push support belongs to this browser session, not the data.
          shouldDehydrateQuery: (query) =>
            query.state.status === 'success' && query.queryKey[0] !== 'push-state',
        },
      }}
      // The restored copy is only for showing something right away and for offline use. Mark
      // it stale so that, when online, everything on screen refetches.
      onSuccess={() => void queryClient.invalidateQueries()}
    >
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  </StrictMode>,
)

void startOutbox()

// Installs the service worker, which keeps the app working offline and shows reminders.
registerSW({ immediate: true })
