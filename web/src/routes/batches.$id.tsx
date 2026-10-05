import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { TaskRow } from '../components/TaskRow'
import { Card, ErrorMessage, SectionTitle, secondaryButtonClass } from '../components/ui'
import { api, type BatchDetail, batchQuery, unwrap } from '../lib/api'
import { stepLabels, stepNames } from '../lib/labels'
import { formatWhen, formatWindow } from '../lib/time'

export const Route = createFileRoute('/batches/$id')({
  component: BatchPage,
})

function BatchPage() {
  const { id } = Route.useParams()
  const batch = useQuery(batchQuery(id))

  if (batch.isPending) return <p className="text-stone-500">Loading...</p>
  if (batch.isError) return <ErrorMessage error={batch.error} />

  return <Batch detail={batch.data} />
}

function Batch({ detail }: { detail: BatchDetail }) {
  const { batch, plant } = detail
  const statusLabel =
    batch.status === 'active'
      ? stepLabels[batch.current_action]
      : batch.status === 'harvested'
        ? 'Harvested'
        : 'Discarded'

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{plant.name}</h1>
            {plant.name_lat && <p className="text-sm text-stone-500 italic">{plant.name_lat}</p>}
          </div>
          <span className="rounded-full bg-green-50 px-3 py-1 text-sm text-green-800">
            {statusLabel}
          </span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-stone-500">Container</dt>
          <dd>{batch.container}</dd>
          <dt className="text-stone-500">Seed</dt>
          <dd>{batch.seed_g} g</dd>
          <dt className="text-stone-500">Started</dt>
          <dd>{formatWhen(batch.started_at)}</dd>
          {batch.harvest_window && (
            <>
              <dt className="text-stone-500">Harvest</dt>
              <dd>{formatWindow(batch.harvest_window.earliest, batch.harvest_window.latest)}</dd>
            </>
          )}
        </dl>
        {detail.notes && <p className="mt-4 text-sm whitespace-pre-wrap">{detail.notes}</p>}
      </Card>

      {batch.status === 'active' && (
        <Card>
          <SectionTitle>To do</SectionTitle>
          <ul className="divide-y divide-stone-100">
            {detail.open_tasks.map((task) => (
              <TaskRow key={task.id} task={task} showBatch={false} />
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <SectionTitle>Steps</SectionTitle>
        <ol className="flex flex-col gap-3">
          {plant.steps.map((step, index) => {
            const record = detail.steps.find((entry) => entry.step_index === index)
            const planned = detail.upcoming.find((window) => window.step_index === index)
            const current = batch.status === 'active' && index === batch.current_step

            return (
              <li key={index} className={current ? 'font-medium' : record ? 'text-stone-500' : ''}>
                <div className="flex justify-between gap-3">
                  <span>
                    {index + 1}. {stepNames[step.action]}
                    {step.duration_min &&
                      ` (${step.duration_min}${step.duration_max ? ` to ${step.duration_max}` : ''})`}
                  </span>
                  <span className="text-sm">
                    {record
                      ? formatWhen(record.started_at)
                      : planned
                        ? `~${formatWindow(planned.earliest_start, planned.latest_start)}`
                        : ''}
                  </span>
                </div>
                {step.note && <p className="text-sm font-normal text-stone-500">{step.note}</p>}
              </li>
            )
          })}
        </ol>
      </Card>

      {batch.status === 'active' && <DiscardButton id={batch.id} />}
    </div>
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
      <ErrorMessage error={discard.error} />
      <button
        type="button"
        disabled={discard.isPending}
        onClick={() => {
          if (window.confirm('Discard this batch? Its reminders stop.')) discard.mutate()
        }}
        className={`${secondaryButtonClass} text-red-700`}
      >
        Discard batch
      </button>
    </div>
  )
}
