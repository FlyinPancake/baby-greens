import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { getHealth } from '../lib/api'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth })

  if (health.isPending) {
    return <p>Checking the server...</p>
  }

  if (health.isError) {
    return <p className="text-red-700">Can't reach the server: {health.error.message}</p>
  }

  return (
    <p>
      Server is up. Database is{' '}
      <span className={health.data.database ? 'text-green-700' : 'text-red-700'}>
        {health.data.database ? 'reachable' : 'unreachable'}
      </span>
      .
    </p>
  )
}
