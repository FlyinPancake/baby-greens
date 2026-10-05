import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet, useSearch } from '@tanstack/react-router'
import { buttonClass, secondaryButtonClass } from '../components/ui'
import { loginUrl, logout, meQuery } from '../lib/api'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
})

function RootLayout() {
  const me = useQuery(meQuery)

  return (
    <div className="min-h-dvh bg-stone-50 text-stone-900">
      <header className="flex items-center justify-between gap-4 border-b border-stone-200 bg-white px-4 py-3">
        <div className="flex items-center gap-5">
          <Link to="/" className="text-lg font-semibold text-green-800">
            baby-greens
          </Link>
          {me.data && (
            <nav className="flex gap-4 text-sm">
              <Link to="/" className="text-stone-600 [&.active]:font-semibold [&.active]:text-stone-900">
                Today
              </Link>
              <Link
                to="/plants"
                className="text-stone-600 [&.active]:font-semibold [&.active]:text-stone-900"
              >
                Plants
              </Link>
            </nav>
          )}
        </div>
        {me.data && <AccountMenu name={me.data.display_name} />}
      </header>
      <main className="mx-auto max-w-2xl p-4">
        {me.isPending ? (
          <p className="text-stone-500">Loading...</p>
        ) : me.isError ? (
          <p className="text-red-700">Can't reach the server: {me.error.message}</p>
        ) : me.data ? (
          <Outlet />
        ) : (
          <SignIn />
        )}
      </main>
    </div>
  )
}

function AccountMenu({ name }: { name: string }) {
  const queryClient = useQueryClient()
  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear()
      queryClient.setQueryData(meQuery.queryKey, null)
    },
  })

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="hidden text-stone-600 sm:inline">{name}</span>
      <button
        type="button"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
        className={secondaryButtonClass}
      >
        Sign out
      </button>
    </div>
  )
}

const authErrorMessages: Record<string, string> = {
  provider: 'The login provider cancelled or refused the sign-in.',
  expired: 'The sign-in took too long. Try again.',
  state_mismatch: "The sign-in couldn't be verified. Try again.",
  not_allowed: "Your account isn't allowed to use this app.",
  failed: 'Sign-in failed. The server log has the details.',
}

function SignIn() {
  const search: { auth_error?: unknown } = useSearch({ strict: false })
  const error = typeof search.auth_error === 'string' ? authErrorMessages[search.auth_error] : null
  const returnTo = window.location.pathname === '/' ? '/' : window.location.pathname

  return (
    <div className="mt-16 flex flex-col items-center gap-4 text-center">
      <p className="text-stone-600">Track your sprouts and microgreens.</p>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <a href={loginUrl(returnTo)} className={buttonClass}>
        Sign in
      </a>
    </div>
  )
}
