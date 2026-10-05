import { type QueryClient, useQuery } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet, useSearch } from '@tanstack/react-router'
import { CalendarCheck, Container, type LucideIcon, Settings, Sprout } from 'lucide-react'
import type { ReactNode } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { SyncBanner } from '@/components/SyncBanner'
import { Highlight } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { loginUrl, meQuery } from '@/lib/api'
import { SproutingJar } from '@/lib/icons'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
})

function RootLayout() {
  const me = useQuery(meQuery)

  return (
    <div className="min-h-dvh text-foreground">
      <header className="sticky top-0 z-40 border-b-2 border-border bg-secondary-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" aria-label="baby greens home" className="flex items-center gap-2">
            <span className="grid size-9 -rotate-6 place-items-center rounded-base border-2 border-border bg-main shadow-shadow">
              <SproutingJar className="size-5" />
            </span>
            <span className="hidden font-heading text-xl tracking-tight sm:inline">baby greens</span>
          </Link>
          {me.data && (
            <div className="flex items-center gap-2">
              <nav className="flex gap-2">
                <NavLink to="/" icon={CalendarCheck}>
                  Today
                </NavLink>
                <NavLink to="/plants" icon={Sprout}>
                  Plants
                </NavLink>
                <NavLink to="/containers" icon={Container}>
                  Jars
                </NavLink>
                <NavLink to="/settings" icon={Settings}>
                  Settings
                </NavLink>
              </nav>
            </div>
          )}
        </div>
        <SyncBanner />
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* Cached data wins over a failed refresh, so the app keeps working offline. */}
        {me.data ? (
          <Outlet />
        ) : me.isPending ? (
          <p className="font-heading">Loading...</p>
        ) : me.isError ? (
          <ErrorAlert error={me.error} />
        ) : (
          <SignIn />
        )}
      </main>
    </div>
  )
}

/** A header link. Phones show only the icon, so all four fit at 320 px. */
function NavLink({
  to,
  icon: Icon,
  children,
}: {
  to: '/' | '/plants' | '/containers' | '/settings'
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === '/' }}
      aria-label={typeof children === 'string' ? children : undefined}
      className="flex items-center gap-1.5 rounded-base border-2 border-border bg-secondary-background px-2.5 py-1.5 text-sm font-heading transition-all hover:bg-main sm:px-3 [&.active]:bg-main [&.active]:shadow-shadow"
    >
      <Icon className="size-4" />
      <span className="hidden sm:inline">{children}</span>
    </Link>
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
          baby greens tracks every jar and tray, tells you when to rinse, water, or move into
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
