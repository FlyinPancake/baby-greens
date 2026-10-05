import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ApiError } from '@/lib/api'

/** An error from a query or mutation, with field problems when the server sent them. */
export function ErrorAlert({ error }: { error: Error | null }) {
  if (!error) return null
  const problems = error instanceof ApiError ? error.problems : []

  return (
    <Alert className="bg-overdue">
      <TriangleAlert />
      <AlertTitle>{problems.length > 0 ? 'That needs a fix' : 'Something went wrong'}</AlertTitle>
      <AlertDescription>
        {problems.length > 0 ? (
          <ul className="list-inside list-disc">
            {problems.map((problem) => (
              <li key={`${problem.path}: ${problem.message}`}>
                <code className="font-heading">{problem.path}</code> {problem.message}
              </li>
            ))}
          </ul>
        ) : (
          <p>{error.message}</p>
        )}
      </AlertDescription>
    </Alert>
  )
}
