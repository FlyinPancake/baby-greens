import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { loginUrl, meQuery } from '../lib/api'

type AuthError = 'provider' | 'expired' | 'state_mismatch' | 'not_allowed' | 'failed'

const authErrorMessages: Record<AuthError, string> = {
  provider: 'The login provider cancelled or refused the sign-in.',
  expired: 'The sign-in took too long. Try again.',
  state_mismatch: "The sign-in couldn't be verified. Try again.",
  not_allowed: "Your account isn't allowed to use this app.",
  failed: 'Sign-in failed. The server log has the details.',
}

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { auth_error?: AuthError } => {
    const error = search.auth_error
    return typeof error === 'string' && error in authErrorMessages
      ? { auth_error: error as AuthError }
      : {}
  },
  component: Home,
})

function Home() {
  const me = useQuery(meQuery)
  const { auth_error } = Route.useSearch()

  if (me.isPending) {
    return <p className="text-stone-500">Loading...</p>
  }

  if (me.isError) {
    return <p className="text-red-700">Can't reach the server: {me.error.message}</p>
  }

  if (!me.data) {
    return <SignIn error={auth_error} />
  }

  return <p>Signed in as {me.data.display_name}. Your batches will show up here.</p>
}

function SignIn({ error }: { error?: AuthError }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-4 text-center">
      <p className="text-stone-600">Track your sprouts and microgreens.</p>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {authErrorMessages[error]}
        </p>
      )}
      <a
        href={loginUrl('/')}
        className="rounded-md bg-green-700 px-4 py-2 font-medium text-white hover:bg-green-800"
      >
        Sign in
      </a>
    </div>
  )
}
