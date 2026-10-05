import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, type TaskView, unwrap } from '@/lib/api'
import { celebrate } from '@/lib/celebrate'
import { taskLabel } from '@/lib/labels'
import { formatWhen } from '@/lib/time'
import { useNow } from '@/lib/useNow'
import { cn } from '@/lib/utils'
import { ErrorAlert } from './ErrorAlert'
import { TaskIcon } from './TaskIcon'

export function TaskCard({ task, showBatch = true }: { task: TaskView; showBatch?: boolean }) {
  const queryClient = useQueryClient()
  const now = useNow()
  const complete = useMutation({
    mutationFn: () =>
      unwrap(api.POST('/tasks/{id}/complete', { params: { path: { id: task.id } } })),
    onSuccess: () => {
      if (task.kind === 'advance' && task.action === 'harvest') celebrate()
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['batches'] }),
      ]),
  })

  const overdue = task.overdue_at != null && new Date(task.overdue_at) <= now
  const due = new Date(task.due_at) <= now

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-base border-2 border-border bg-secondary-background p-3 shadow-shadow',
        overdue && 'bg-overdue/25',
      )}
    >
      <span
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-base border-2 border-border',
          task.kind === 'advance' ? 'bg-due' : 'bg-main',
        )}
      >
        <TaskIcon task={task} className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-heading">{taskLabel(task)}</p>
        <p className="text-sm">
          {showBatch && (
            <>
              <Link
                to="/batches/$id"
                params={{ id: task.batch_id }}
                className="underline decoration-2 underline-offset-2 hover:bg-main"
              >
                {task.plant_name}, {task.container}
              </Link>
              {' · '}
            </>
          )}
          <span
            className={cn(
              overdue && 'rounded-base border-2 border-border bg-overdue px-1 font-heading',
              !overdue && due && 'font-heading',
            )}
          >
            {overdue
              ? `overdue since ${formatWhen(task.overdue_at!, now)}`
              : due
                ? `due ${formatWhen(task.due_at, now)}`
                : formatWhen(task.due_at, now)}
          </span>
        </p>
        <ErrorAlert error={complete.error} />
      </div>
      <Button
        size="icon"
        aria-label={`Mark "${taskLabel(task)}" done`}
        onClick={() => complete.mutate()}
        disabled={complete.isPending}
        className={cn(complete.isPending && 'animate-pop')}
      >
        <Check className="size-5" />
      </Button>
    </li>
  )
}
