import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Check, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { stepIcons } from '@/lib/icons'
import { TaskCard } from '@/components/TaskCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { api, type BatchDetail, batchQuery, unwrap } from '@/lib/api'
import { stepLabels, stepNames } from '@/lib/labels'
import { formatRange, formatWhen, formatWindow, percentBetween } from '@/lib/time'
import { useNow } from '@/lib/useNow'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/batches/$id')({
  component: BatchPage,
})

function BatchPage() {
  const { id } = Route.useParams()
  const batch = useQuery(batchQuery(id))

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link to="/" className="flex w-fit items-center gap-1 font-heading hover:underline">
        <ArrowLeft className="size-4" /> Today
      </Link>
      {batch.isPending ? (
        <p className="font-heading">Loading...</p>
      ) : batch.isError ? (
        <ErrorAlert error={batch.error} />
      ) : (
        <Batch detail={batch.data} />
      )}
    </div>
  )
}

const statusStyles = {
  active: 'bg-main',
  harvested: 'bg-due',
  discarded: 'bg-overdue',
} as const

function Batch({ detail }: { detail: BatchDetail }) {
  const now = useNow()
  const { batch, plant } = detail
  const status = batch.status === 'active' ? stepLabels[batch.current_action] : batch.status
  const progress = batch.harvest_window
    ? percentBetween(batch.started_at, batch.harvest_window.earliest, now)
    : 100

  return (
    <>
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-4xl tracking-tight">{plant.name}</h1>
            {plant.name_lat && <p className="italic">{plant.name_lat}</p>}
          </div>
          <Badge className={cn('rotate-3 px-3 py-1 text-sm font-heading capitalize shadow-shadow', statusStyles[batch.status])}>
            {status}
          </Badge>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label="Container">
            <Link
              to="/containers/$id"
              params={{ id: batch.container_id }}
              className="underline decoration-2 underline-offset-2"
            >
              {batch.container}
            </Link>
          </Fact>
          <Fact label="Seed">{batch.seed_g} g</Fact>
          <Fact label="Started">{formatWhen(batch.started_at, now)}</Fact>
          <Fact label="Harvest">
            {batch.harvest_window
              ? formatWindow(batch.harvest_window.earliest, batch.harvest_window.latest, now)
              : batch.status === 'harvested'
                ? 'Done'
                : 'Stopped'}
          </Fact>
        </dl>

        {batch.status === 'active' && (
          <Progress value={progress} aria-label="Progress to the earliest harvest" />
        )}
        {detail.notes && (
          <p className="rounded-base border-2 border-border bg-secondary-background p-3 whitespace-pre-wrap">
            {detail.notes}
          </p>
        )}
      </section>

      {batch.status === 'active' && detail.open_tasks.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl">To do</h2>
          <ul className="flex flex-col gap-3">
            {detail.open_tasks.map((task) => (
              <TaskCard key={task.id} task={task} showBatch={false} />
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl">Steps</h2>
        <Steps detail={detail} now={now} />
      </section>

      {batch.status === 'active' && <DiscardButton id={batch.id} />}
    </>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-base border-2 border-border bg-secondary-background p-3 shadow-shadow">
      <dt className="text-xs font-heading tracking-wide uppercase">{label}</dt>
      <dd className="mt-1 truncate font-heading">{children}</dd>
    </div>
  )
}

function Steps({ detail, now }: { detail: BatchDetail; now: Date }) {
  const { batch, plant } = detail

  return (
    <ol className="relative flex flex-col gap-4 before:absolute before:top-2 before:bottom-2 before:left-[21px] before:w-0.5 before:bg-border">
      {plant.steps.map((step, index) => {
        const record = detail.steps.find((entry) => entry.step_index === index)
        const planned = detail.upcoming.find((window) => window.step_index === index)
        const current = batch.status === 'active' && index === batch.current_step
        const done = record != null && !current
        const Icon = done ? Check : stepIcons[step.action]

        return (
          <li key={index} className="relative flex gap-4">
            <span
              className={cn(
                'z-10 grid size-11 shrink-0 place-items-center rounded-base border-2 border-border',
                done && 'bg-main',
                current && 'bg-due shadow-shadow',
                !record && 'bg-secondary-background',
              )}
            >
              <Icon className="size-5" />
            </span>
            <div
              className={cn(
                'flex-1 rounded-base border-2 border-border bg-secondary-background p-3',
                current && 'shadow-shadow',
                !record && 'border-dashed',
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-heading">
                  {stepNames[step.action]}
                  {step.duration_min && (
                    <span className="ml-2 font-base text-sm">{formatRange(step.duration_min, step.duration_max)}</span>
                  )}
                </p>
                <p className="text-sm">
                  {record
                    ? formatWhen(record.started_at, now)
                    : planned
                      ? `around ${formatWindow(planned.earliest_start, planned.latest_start, now)}`
                      : ''}
                </p>
              </div>
              {current && (
                <Badge className="mt-2 bg-due font-heading uppercase">You are here</Badge>
              )}
              {step.note && <p className="mt-2 text-sm">{step.note}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function DiscardButton({ id }: { id: string }) {
  const queryClient = useQueryClient()
  const discard = useMutation({
    mutationFn: () => unwrap(api.POST('/batches/{id}/discard', { params: { path: { id } } })),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['batches'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      ]),
  })

  return (
    <div className="flex flex-col items-end gap-2">
      <ErrorAlert error={discard.error} />
      <Button
        variant="neutral"
        disabled={discard.isPending}
        onClick={() => {
          if (window.confirm('Discard this batch? Its reminders stop.')) discard.mutate()
        }}
      >
        <Trash2 /> Discard batch
      </Button>
    </div>
  )
}
