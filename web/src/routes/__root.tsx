import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="min-h-dvh bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 px-4 py-3">
        <h1 className="text-lg font-semibold">baby-greens</h1>
      </header>
      <main className="mx-auto max-w-2xl p-4">
        <Outlet />
      </main>
    </div>
  )
}
