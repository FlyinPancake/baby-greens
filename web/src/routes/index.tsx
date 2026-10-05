import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import { BatchRow } from '../components/BatchRow'
import { TaskRow } from '../components/TaskRow'
import { buttonClass, Card, ErrorMessage, SectionTitle } from '../components/ui'
import { batchesQuery, tasksQuery } from '../lib/api'
import { endOfToday } from '../lib/time'

export const Route = createFileRoute('/')({
  component: Today,
})

function Today() {
  // Computing this on every render would change the query key, so keep it for the life of the page.
  const dueBefore = useMemo(() => endOfToday(), [])
  const tasks = useQuery(tasksQuery(dueBefore))
  const batches = useQuery(batchesQuery('active'))

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <SectionTitle>Today</SectionTitle>
        <ErrorMessage error={tasks.error} />
        {tasks.isPending ? (
          <p className="text-stone-500">Loading...</p>
        ) : tasks.data?.length === 0 ? (
          <p className="text-stone-500">Nothing left to do today.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {tasks.data?.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle>Growing</SectionTitle>
          <Link to="/batches/new" className={buttonClass}>
            Start a batch
          </Link>
        </div>
        <ErrorMessage error={batches.error} />
        {batches.isPending ? (
          <p className="text-stone-500">Loading...</p>
        ) : batches.data?.length === 0 ? (
          <p className="text-stone-500">No batches growing. Start one to get reminders.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {batches.data?.map((batch) => (
              <BatchRow key={batch.id} batch={batch} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
