import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { CSSProperties } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Highlight, PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { calendarQuery, type StepAction } from '@/lib/api'
import { monthWeeks, type Placed, placeWeek, type Segment, timeline, type Week } from '@/lib/calendar'
import { stepNames } from '@/lib/labels'
import { useNow } from '@/lib/useNow'
import { cn } from '@/lib/utils'

type Search = { month?: string }

export const Route = createFileRoute('/calendar')({
  component: Calendar,
  validateSearch: (search: Record<string, unknown>): Search => ({
    month:
      typeof search.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(search.month)
        ? search.month
        : undefined,
  }),
})

const stepColors: Record<StepAction, string> = {
  soak: 'var(--chart-3)',
  sprout: 'var(--chart-1)',
  blackout: 'var(--chart-5)',
  light: 'var(--chart-4)',
  harvest: 'var(--chart-2)',
}

const planned = 'repeating-linear-gradient(135deg, transparent 0 3px, rgb(255 255 255 / 0.6) 3px 6px)'

/** The height of one row of bars, in pixels. */
const LANE = 26

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' })

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function parseMonth(key: string | undefined, now: Date): Date {
  if (!key) return new Date(now.getFullYear(), now.getMonth(), 1)
  const [year, month] = key.split('-').map(Number)
  return new Date(year, month - 1, 1)
}

function Calendar() {
  const now = useNow()
  const search = Route.useSearch()
  const month = parseMonth(search.month, now)
  const weeks = monthWeeks(month)
  const from = new Date(weeks[0].start)
  const to = new Date(weeks[weeks.length - 1].end)
  const batches = useQuery(calendarQuery(from, to))
  const timelines = batches.data?.map((entry) => timeline(entry, now.getTime())) ?? []

  const shift = (months: number) =>
    monthKey(new Date(month.getFullYear(), month.getMonth() + months, 1))
  const isThisMonth = monthKey(month) === monthKey(now)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeading>
        Grow <Highlight>calendar</Highlight>
      </PageHeading>

      <div className="flex items-center justify-between gap-2">
        <h2 className="text-2xl">{monthFormat.format(month)}</h2>
        <div className="flex gap-2">
          {!isThisMonth && (
            <Button variant="neutral" size="sm" nativeButton={false} render={<Link to="/calendar" />}>
              Today
            </Button>
          )}
          <Button
            variant="neutral"
            size="icon-sm"
            aria-label="Previous month"
            nativeButton={false}
            render={<Link to="/calendar" search={{ month: shift(-1) }} />}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="neutral"
            size="icon-sm"
            aria-label="Next month"
            nativeButton={false}
            render={<Link to="/calendar" search={{ month: shift(1) }} />}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <ErrorAlert error={batches.error} />

      <div className="overflow-hidden rounded-base border-2 border-border bg-secondary-background shadow-shadow">
        <div className="grid grid-cols-7 bg-main text-main-foreground">
          {weeks[0].days.map((day) => (
            <p key={day.getDay()} className="py-1 text-center text-xs font-heading tracking-wide uppercase">
              {weekdayFormat.format(day)}
            </p>
          ))}
        </div>
        {weeks.map((week) => (
          <WeekRow key={week.start} week={week} month={month} now={now} bars={placeWeek(timelines, week)} />
        ))}
      </div>

      {batches.isPending ? (
        <p className="font-heading">Loading...</p>
      ) : (
        timelines.length === 0 && <p>Nothing grew this month.</p>
      )}

      <Legend />
    </div>
  )
}

function WeekRow({
  week,
  month,
  now,
  bars,
}: {
  week: Week
  month: Date
  now: Date
  bars: { bars: Placed[]; lanes: number }
}) {
  const nowAt = (now.getTime() - week.start) / (week.end - week.start)
  const today = now.toDateString()

  return (
    <div className="relative border-t-2 border-border pt-8 pb-2">
      <div className="absolute inset-0 grid grid-cols-7 grid-rows-1">
        {week.days.map((day) => {
          const isToday = day.toDateString() === today
          return (
            <div
              key={day.getTime()}
              className={cn(
                'border-l-2 border-border/20 px-1 pt-1 first:border-l-0',
                day.getMonth() !== month.getMonth() && 'bg-foreground/5 text-foreground/50',
                isToday && 'bg-main/25',
              )}
            >
              <span
                className={cn(
                  'inline-block min-w-6 rounded-base px-1 text-center text-xs font-heading',
                  isToday && 'border-2 border-border bg-main text-main-foreground',
                )}
              >
                {day.getDate()}
              </span>
            </div>
          )
        })}
      </div>
      {nowAt >= 0 && nowAt < 1 && (
        <div
          aria-hidden
          className="absolute inset-y-0 z-20 w-0.5 bg-overdue"
          style={{ left: `${nowAt * 100}%` }}
        />
      )}
      <div className="relative" style={{ height: Math.max(1, bars.lanes) * LANE }}>
        {bars.bars.map((bar) => (
          <Bar key={bar.timeline.entry.batch.id} bar={bar} week={week} />
        ))}
      </div>
    </div>
  )
}

function Bar({ bar, week }: { bar: Placed; week: Week }) {
  const { batch } = bar.timeline.entry
  const length = week.end - week.start
  const start = week.start + bar.left * length
  const end = week.start + bar.right * length
  const harvest = bar.timeline.harvest
  const segments: Segment[] = harvest
    ? [...bar.timeline.segments, { action: 'harvest', ...harvest, planned: true }]
    : bar.timeline.segments

  const place = (segment: Segment): CSSProperties | null => {
    const from = Math.max(segment.start, start)
    const to = Math.min(segment.end, end)
    if (to <= from) return null
    return {
      left: `${((from - start) / (end - start)) * 100}%`,
      width: `${((to - from) / (end - start)) * 100}%`,
      backgroundColor: stepColors[segment.action],
      backgroundImage: segment.planned ? planned : undefined,
    }
  }

  return (
    <Link
      to="/batches/$id"
      params={{ id: batch.id }}
      aria-label={`${batch.plant_name} in ${batch.container}`}
      title={`${batch.plant_name} in ${batch.container}`}
      className={cn(
        'absolute z-10 flex h-5 items-center overflow-hidden border-2 border-border bg-white text-black transition-transform hover:-translate-y-0.5',
        // Square ends show that the batch carries on into the next or previous week.
        !bar.continuesBefore && 'rounded-l-base',
        !bar.continuesAfter && 'rounded-r-base',
        batch.status === 'discarded' && 'opacity-50',
      )}
      style={{
        top: bar.lane * LANE,
        left: `${bar.left * 100}%`,
        width: `${(bar.right - bar.left) * 100}%`,
      }}
    >
      {segments.map((segment, index) => {
        const style = place(segment)
        return style && <span key={index} aria-hidden className="absolute inset-y-0" style={style} />
      })}
      <span className="relative truncate px-1 text-[11px] leading-none font-heading">
        {batch.plant_name}
        <span className="font-base"> · {batch.container}</span>
      </span>
    </Link>
  )
}

function Legend() {
  const steps: StepAction[] = ['soak', 'sprout', 'blackout', 'light']

  return (
    <div className="flex flex-col gap-2 text-sm">
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {steps.map((action) => (
          <LegendItem key={action} style={{ backgroundColor: stepColors[action] }}>
            {stepNames[action]}
          </LegendItem>
        ))}
        <LegendItem style={{ backgroundColor: stepColors.harvest, backgroundImage: planned }}>
          Harvest window
        </LegendItem>
        <LegendItem style={{ backgroundColor: stepColors.sprout, backgroundImage: planned }}>
          Planned
        </LegendItem>
      </ul>
      <p>
        Planned steps assume each one takes its shortest time. The red line is now. Tap a batch to
        open it.
      </p>
    </div>
  )
}

function LegendItem({ style, children }: { style: CSSProperties; children: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className="inline-block h-3 w-5 rounded-sm border-2 border-border" style={style} />
      {children}
    </li>
  )
}
