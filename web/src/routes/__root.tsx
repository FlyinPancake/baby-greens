import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { logout, meQuery } from '../lib/api'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="min-h-dvh bg-stone-50 text-stone-900">
      <header className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
        <h1 className="text-lg font-semibold">baby-greens</h1>
        <AccountMenu />
      </header>
      <main className="mx-auto max-w-2xl p-4">
        <Outlet />
      </main>
    </div>
  )
}

function AccountMenu() {
  const queryClient = useQueryClient()
  const me = useQuery(meQuery)
  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => queryClient.setQueryData(meQuery.queryKey, null),
  })

  if (!me.data) {
    return null
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-stone-600">{me.data.display_name}</span>
      <button
        type="button"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
        className="rounded-md border border-stone-300 px-3 py-1 hover:bg-stone-100 disabled:opacity-50"
      >
        Sign out
      </button>
    </div>
  )
}
