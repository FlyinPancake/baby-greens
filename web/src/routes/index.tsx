import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CalendarCheck, Plus, Sprout } from 'lucide-react'
import type { ReactNode } from 'react'
import { BatchCard } from '@/components/BatchCard'
import { EmptyState } from '@/components/EmptyState'
import { ReminderNudge } from '@/components/ReminderNudge'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Highlight } from '@/components/PageHeading'
import { TaskCard } from '@/components/TaskCard'
import { Button } from '@/components/ui/button'
import { batchesQuery, meQuery, tasksQuery } from '@/lib/api'
import { taskLabel } from '@/lib/labels'
import { endOfToday, formatWhen, formatWindow } from '@/lib/time'
import { usePendingTasks } from '@/lib/useOutbox'
import { useNow } from '@/lib/useNow'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({
  component: Today,
})

function greeting(now: Date): string {
  const hour = now.getHours()
  if (hour < 5) return 'Up late'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function Today() {
  const now = useNow()
  const me = useQuery(meQuery)
  const tasks = useQuery(tasksQuery)
  const batches = useQuery(batchesQuery({ status: 'active' }))

  const endOfDay = endOfToday(now)
  const open = usePendingTasks(tasks.data)
  const today = open.filter((task) => new Date(task.due_at) <= endOfDay)
  const nextUp = open.find((task) => new Date(task.due_at) > endOfDay)
  const nextHarvest = batches.data
    ?.flatMap((batch) => (batch.harvest_window ? [batch.harvest_window] : []))
    .sort((a, b) => a.earliest.localeCompare(b.earliest))[0]

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h1 className="text-4xl tracking-tight sm:text-5xl">
          {greeting(now)}, <Highlight>{me.data?.display_name}</Highlight>
        </h1>
        {/* On phones the harvest window gets a row of its own, so "tomorrow" isn't split. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="To do today" value={tasks.isPending ? '…' : today.length} tone="bg-due" />
          <Stat label="Growing" value={batches.isPending ? '…' : (batches.data?.length ?? 0)} tone="bg-main" />
          <Stat
            label="Next harvest"
            value={nextHarvest ? formatWindow(nextHarvest.earliest, nextHarvest.latest, now) : 'None yet'}
            tone="bg-secondary-background"
            className="col-span-2 sm:col-span-1"
          />
        </div>
      </section>

      <ReminderNudge />

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl">Today</h2>
        <ErrorAlert error={tasks.error} />
        {tasks.isPending ? (
          <p className="font-heading">Loading...</p>
        ) : today.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="All done for today">
            {nextUp
              ? `Next up: ${taskLabel(nextUp).toLowerCase()} for ${nextUp.plant_name}, ${formatWhen(nextUp.due_at, now)}.`
              : 'Start a batch to get reminders.'}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {today.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl">Growing</h2>
          <Button nativeButton={false} render={<Link to="/batches/new" />}>
            <Plus /> Start a batch
          </Button>
        </div>
        <ErrorAlert error={batches.error} />
        {batches.isPending ? (
          <p className="font-heading">Loading...</p>
        ) : batches.data?.length === 0 ? (
          <EmptyState icon={Sprout} title="Nothing growing yet">
            Pick a plant, fill a jar or tray, and start a batch.
          </EmptyState>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {batches.data?.map((batch) => (
              <BatchCard key={batch.id} batch={batch} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  className,
}: {
  label: string
  value: ReactNode
  tone: string
  className?: string
}) {
  return (
    <div className={cn('rounded-base border-2 border-border p-3 shadow-shadow', tone, className)}>
      <p className="text-[10px] font-heading tracking-wide uppercase sm:text-xs">{label}</p>
      <p className="mt-1 font-heading text-xl leading-tight break-words sm:text-3xl">{value}</p>
    </div>
  )
}
