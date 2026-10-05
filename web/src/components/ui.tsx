import type { ReactNode } from 'react'
import type { Problem } from '../lib/api'
import { ApiError } from '../lib/api'

export function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-lg border border-stone-200 bg-white p-4">{children}</section>
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold tracking-wide text-stone-500 uppercase">{children}</h2>
}

export const buttonClass =
  'rounded-md bg-green-700 px-4 py-2 font-medium text-white hover:bg-green-800 disabled:opacity-50'

export const secondaryButtonClass =
  'rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 disabled:opacity-50'

export const inputClass =
  'w-full rounded-md border border-stone-300 bg-white px-3 py-2 focus:border-green-700 focus:outline-none'

/** Shows an error from a query or mutation, with field problems when the server sent them. */
export function ErrorMessage({ error }: { error: Error | null }) {
  if (!error) return null
  const problems: Problem[] = error instanceof ApiError ? error.problems : []

  return (
    <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
      {problems.length > 0 ? (
        <ul className="list-inside list-disc">
          {problems.map((problem) => (
            <li key={`${problem.path}: ${problem.message}`}>
              <code>{problem.path}</code> {problem.message}
            </li>
          ))}
        </ul>
      ) : (
        error.message
      )}
    </div>
  )
}
