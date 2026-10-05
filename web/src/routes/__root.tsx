import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet, useSearch } from '@tanstack/react-router'
import { LogOut, Sprout } from 'lucide-react'
import type { ReactNode } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Highlight } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { loginUrl, logout, meQuery } from '@/lib/api'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
})

function RootLayout() {
  const me = useQuery(meQuery)

  return (
    <div className="min-h-dvh text-foreground">
      <header className="sticky top-0 z-40 border-b-2 border-border bg-secondary-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" aria-label="baby-greens home" className="flex items-center gap-2">
            <span className="grid size-9 -rotate-6 place-items-center rounded-base border-2 border-border bg-main shadow-shadow">
              <Sprout className="size-5" />
            </span>
            <span className="hidden font-heading text-xl tracking-tight sm:inline">baby-greens</span>
          </Link>
          {me.data && (
            <div className="flex items-center gap-2">
              <nav className="flex gap-2">
                <NavLink to="/">Today</NavLink>
                <NavLink to="/plants">Plants</NavLink>
              </nav>
              <SignOutButton name={me.data.display_name} />
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {me.isPending ? (
          <p className="font-heading">Loading...</p>
        ) : me.isError ? (
          <ErrorAlert error={me.error} />
        ) : me.data ? (
          <Outlet />
        ) : (
          <SignIn />
        )}
      </main>
    </div>
  )
}

function NavLink({ to, children }: { to: '/' | '/plants'; children: ReactNode }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === '/' }}
      className="rounded-base border-2 border-border bg-secondary-background px-3 py-1.5 text-sm font-heading transition-all hover:bg-main [&.active]:bg-main [&.active]:shadow-shadow"
    >
      {children}
    </Link>
  )
}

function SignOutButton({ name }: { name: string }) {
  const queryClient = useQueryClient()
  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear()
      queryClient.setQueryData(meQuery.queryKey, null)
    },
  })

  return (
    <Button
      variant="neutral"
      size="icon-sm"
      onClick={() => signOut.mutate()}
      disabled={signOut.isPending}
      aria-label={`Sign out ${name}`}
      title={`Signed in as ${name}. Sign out.`}
    >
      <LogOut />
    </Button>
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
  const error =
    typeof search.auth_error === 'string' ? authErrorMessages[search.auth_error] : undefined

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 pt-6">
      <div className="flex flex-col gap-5">
        <h1 className="text-4xl leading-tight tracking-tight sm:text-6xl">
          Grow tiny greens.
          <br />
          Never miss a <Highlight>rinse</Highlight>.
        </h1>
        <p className="max-w-md text-lg">
          baby-greens tracks every jar and tray, tells you when to rinse, water, or move into
          light, and says when it's time to harvest.
        </p>
        {error && <ErrorAlert error={new Error(error)} />}
        <div>
          <Button size="lg" nativeButton={false} render={<a href={loginUrl(window.location.pathname)} />}>
            Sign in
          </Button>
        </div>
      </div>
    </div>
  )
}
