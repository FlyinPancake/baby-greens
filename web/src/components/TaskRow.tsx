import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api, type TaskView, unwrap } from '../lib/api'
import { taskLabel } from '../lib/labels'
import { formatWhen } from '../lib/time'
import { useNow } from '../lib/useNow'
import { ErrorMessage, secondaryButtonClass } from './ui'

export function TaskRow({ task, showBatch = true }: { task: TaskView; showBatch?: boolean }) {
  const queryClient = useQueryClient()
  const complete = useMutation({
    mutationFn: () =>
      unwrap(api.POST('/tasks/{id}/complete', { params: { path: { id: task.id } } })),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['batches'] }),
      ]),
  })

  const now = useNow()
  const overdue = task.overdue_at != null && new Date(task.overdue_at) <= now
  const due = new Date(task.due_at) <= now

  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="font-medium">{taskLabel(task)}</p>
        <p className="text-sm text-stone-500">
          {showBatch && (
            <>
              <Link
                to="/batches/$id"
                params={{ id: task.batch_id }}
                className="hover:text-stone-800 hover:underline"
              >
                {task.plant_name}, {task.container}
              </Link>
              {' · '}
            </>
          )}
          <span className={overdue ? 'font-medium text-red-700' : due ? 'text-amber-700' : ''}>
            {overdue ? 'overdue since ' + formatWhen(task.overdue_at!, now) : formatWhen(task.due_at, now)}
          </span>
        </p>
        <ErrorMessage error={complete.error} />
      </div>
      <button
        type="button"
        onClick={() => complete.mutate()}
        disabled={complete.isPending}
        className={secondaryButtonClass}
      >
        Done
      </button>
    </li>
  )
}
