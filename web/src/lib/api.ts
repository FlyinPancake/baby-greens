import { queryOptions } from '@tanstack/react-query'
import createClient from 'openapi-fetch'
import type { components, paths } from './api.gen'

export type Schemas = components['schemas']
export type Me = Schemas['User']
export type LibraryEntry = Schemas['LibraryEntry']
export type Plant = Schemas['Plant']
export type BatchSummary = Schemas['BatchSummary']
export type BatchDetail = Schemas['BatchDetail']
export type BatchStatus = Schemas['BatchStatus']
export type TaskView = Schemas['TaskView']
export type TaskAction = Schemas['TaskAction']
export type StepAction = Schemas['StepAction']
export type CareAction = Schemas['CareAction']
export type Problem = Schemas['Problem']
export type ErrorBody = Schemas['ErrorBody']
export type Container = Schemas['Container']
export type QuietHours = Schemas['QuietHours']
export type Harvest = Schemas['Harvest']
export type PlantStats = Schemas['PlantStats']
export type ContainerKind = Schemas['ContainerKind']

export const api = createClient<paths>({ baseUrl: '/api/v1' })

/** A non-2xx response, with the server's error body when it sent one. */
export class ApiError extends Error {
  readonly status: number
  readonly body: ErrorBody | undefined

  constructor(status: number, body: ErrorBody | undefined) {
    super(body?.message ?? body?.error ?? `request failed with status ${status}`)
    this.status = status
    this.body = body
  }

  get problems(): Problem[] {
    return this.body?.problems ?? []
  }
}

type Result<T> = { data?: T; error?: unknown; response: Response }

/** Returns the response data, or throws an ApiError. */
export async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  let result: Result<T>
  try {
    result = await request
  } catch {
    throw new Error(
      navigator.onLine
        ? "Couldn't reach the server. Try again in a moment."
        : "You're offline. This needs a connection.",
    )
  }
  const { data, error, response } = result
  if (!response.ok) {
    throw new ApiError(response.status, error as ErrorBody | undefined)
  }
  return data as T
}

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async (): Promise<Me | null> => {
    const { data, response } = await api.GET('/me')
    if (response.status === 401) {
      return null
    }
    if (!response.ok || !data) {
      throw new ApiError(response.status, undefined)
    }
    return data
  },
  staleTime: 5 * 60 * 1000,
})

export const plantsQuery = queryOptions({
  queryKey: ['plants'],
  queryFn: () => unwrap(api.GET('/plants')),
})

export const plantQuery = (slug: string) =>
  queryOptions({
    queryKey: ['plants', slug],
    queryFn: () => unwrap(api.GET('/plants/{slug}', { params: { path: { slug } } })),
    retry: false,
  })

export const batchesQuery = (filter: { status?: BatchStatus; containerId?: string } = {}) =>
  queryOptions({
    queryKey: ['batches', filter],
    queryFn: () =>
      unwrap(
        api.GET('/batches', {
          params: { query: { status: filter.status, container_id: filter.containerId } },
        }),
      ),
  })

export const containersQuery = queryOptions({
  queryKey: ['containers'],
  queryFn: () => unwrap(api.GET('/containers')),
})

export const containerQuery = (id: string) =>
  queryOptions({
    queryKey: ['containers', id],
    queryFn: () => unwrap(api.GET('/containers/{id}', { params: { path: { id } } })),
  })

export const batchQuery = (id: string) =>
  queryOptions({
    queryKey: ['batches', id],
    queryFn: () => unwrap(api.GET('/batches/{id}', { params: { path: { id } } })),
  })

/** Every open task on active batches, soonest first. */
export const tasksQuery = queryOptions({
  queryKey: ['tasks'],
  queryFn: () => unwrap(api.GET('/tasks')),
  // Picks up changes made on another device while the page stays open.
  refetchInterval: 60 * 1000,
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

export const plantStatsQuery = queryOptions({
  queryKey: ['stats', 'plants'],
  queryFn: () => unwrap(api.GET('/stats/plants')),
})
