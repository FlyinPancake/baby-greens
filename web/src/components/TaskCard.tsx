import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { AlarmClock, Check, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { TaskView } from '@/lib/api'
import { celebrate } from '@/lib/celebrate'
import { taskLabel } from '@/lib/labels'
import { perform } from '@/lib/outbox'
import { formatWhen } from '@/lib/time'
import { useOtherGrower } from '@/lib/useGrower'
import { useNow } from '@/lib/useNow'
import { cn } from '@/lib/utils'
import { ColorDot } from './ContainerColor'
import { ErrorAlert } from './ErrorAlert'
import { TaskIcon } from './TaskIcon'

type SnoozeOption = { label: string; until: () => Date }

const snoozeOptions: SnoozeOption[] = [
  { label: '30 min', until: () => new Date(Date.now() + 30 * 60 * 1000) },
  { label: '1 hour', until: () => new Date(Date.now() + 60 * 60 * 1000) },
  { label: '3 hours', until: () => new Date(Date.now() + 3 * 60 * 60 * 1000) },
  {
    label: 'Tomorrow 8:00',
    until: () => {
      const morning = new Date()
      morning.setDate(morning.getDate() + 1)
      morning.setHours(8, 0, 0, 0)
      return morning
    },
  },
]

export function TaskCard({ task, showBatch = true }: { task: TaskView; showBatch?: boolean }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const now = useNow()
  const grower = useOtherGrower(task)
  const [snoozing, setSnoozing] = useState(false)
  const label = `${taskLabel(task)} for ${task.plant_name}`
  const harvest = task.kind === 'advance' && task.action === 'harvest'

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['batches'] }),
      queryClient.invalidateQueries({ queryKey: ['stats'] }),
    ])

  // Both go through the outbox, so they work offline and sync later.
  const complete = useMutation({
    mutationFn: () =>
      perform({ kind: 'complete', taskId: task.id, doneAt: new Date().toISOString(), label }),
    onSuccess: async (result) => {
      if (!harvest) return
      celebrate()
      // Online, go straight to logging how the harvest went.
      if (result === 'sent') {
        await navigate({ to: '/batches/$id', params: { id: task.batch_id }, hash: 'harvest-log' })
      }
    },
    onSettled: refresh,
  })

  const snooze = useMutation({
    mutationFn: (until: Date) =>
      perform({ kind: 'snooze', taskId: task.id, until: until.toISOString(), label }),
    onSuccess: () => setSnoozing(false),
    onSettled: refresh,
  })

  const snoozedUntil = task.snoozed_until
  const snoozed = snoozedUntil != null && new Date(snoozedUntil) > now
  const overdue = !snoozed && task.overdue_at != null && new Date(task.overdue_at) <= now
  const due = new Date(task.due_at) <= now

  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-base border-2 border-border bg-secondary-background p-3 shadow-shadow',
        overdue && 'bg-overdue/25',
      )}
    >
      <div className="flex items-center gap-3">
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
                  {task.plant_name},{' '}
                  {task.container_color && (
                    <ColorDot color={task.container_color} className="mr-1 align-[-1px]" />
                  )}
                  {task.container}
                </Link>
                {grower && <>, {grower}'s</>}
                {' · '}
              </>
            )}
            <span
              className={cn(
                overdue && 'rounded-base border-2 border-border bg-overdue px-1 font-heading',
                !overdue && due && 'font-heading',
              )}
            >
              {snoozed
                ? `snoozed until ${formatWhen(snoozedUntil!, now)}`
                : overdue
                  ? `overdue since ${formatWhen(task.overdue_at!, now)}`
                  : due
                    ? `due ${formatWhen(task.due_at, now)}`
                    : formatWhen(task.due_at, now)}
            </span>
          </p>
        </div>
        <Button
          variant="neutral"
          size="icon"
          aria-label={snoozing ? 'Keep it' : `Snooze "${taskLabel(task)}"`}
          aria-expanded={snoozing}
          onClick={() => setSnoozing(!snoozing)}
        >
          {snoozing ? <X className="size-5" /> : <AlarmClock className="size-5" />}
        </Button>
        <Button
          size="icon"
          aria-label={`Mark "${taskLabel(task)}" done`}
          onClick={() => complete.mutate()}
          disabled={complete.isPending}
          className={cn(complete.isPending && 'animate-pop')}
        >
          <Check className="size-5" />
        </Button>
      </div>

      {snoozing && (
        <div role="group" aria-label="Snooze for" className="flex flex-wrap items-center gap-2 pl-14">
          <span className="text-sm font-heading">Remind me in</span>
          {snoozeOptions.map((option) => (
            <button
              key={option.label}
              type="button"
              disabled={snooze.isPending}
              onClick={() => snooze.mutate(option.until())}
              className="h-8 rounded-base border-2 border-border bg-background px-2.5 text-sm font-heading transition-all hover:-translate-y-0.5 hover:bg-main disabled:opacity-50"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      <ErrorAlert error={complete.error ?? snooze.error} />
    </li>
  )
}
