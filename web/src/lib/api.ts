// Hand-written until milestone 4 replaces this with a client generated from the OpenAPI spec.

import { queryOptions } from '@tanstack/react-query'

export type Me = {
  id: string
  display_name: string
  email: string | null
  timezone: string
}

/** Returns null when nobody is signed in. */
export async function getMe(): Promise<Me | null> {
  const response = await fetch('/api/me')
  if (response.status === 401) {
    return null
  }
  if (!response.ok) {
    throw new Error(`loading the current user failed with status ${response.status}`)
  }
  return response.json()
}

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: getMe,
  staleTime: 5 * 60 * 1000,
})

export async function logout(): Promise<void> {
  const response = await fetch('/auth/logout', { method: 'POST' })
  if (!response.ok) {
    throw new Error(`logout failed with status ${response.status}`)
  }
}

/** The server-side login route. Open it with a full page load, not the client router. */
export function loginUrl(returnTo: string): string {
  return `/auth/login?return_to=${encodeURIComponent(returnTo)}`
}
