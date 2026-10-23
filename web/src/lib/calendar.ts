import type { CalendarBatch, StepAction } from './api'

/** A stretch of time a batch spent, or should spend, in one step. Times are in milliseconds. */
export type Segment = {
  action: StepAction
  start: number
  end: number
  /** Not happened yet. Planned steps assume each step takes its shortest time. */
  planned: boolean
}

export type Timeline = {
  entry: CalendarBatch
  segments: Segment[]
  /** When the batch can be harvested, from the shortest to the longest plan. Active batches only. */
  harvest: { start: number; end: number } | null
  start: number
  end: number
}

/**
 * Lays out a batch's steps in time. Finished steps use their real times. For an active batch, the
 * current step runs to now, and the rest follow the server's plan. When the current step is
 * running late, the planned steps move back by the same amount, so they never start in the past.
 */
export function timeline(entry: CalendarBatch, now: number): Timeline {
  const { batch, steps, upcoming } = entry
  const active = batch.status === 'active'
  const segments: Segment[] = []

  for (const step of steps) {
    // Entering harvest ends the batch, so the harvest step is a moment, not a stretch.
    if (step.action === 'harvest') continue
    const start = Date.parse(step.started_at)
    const end = step.ended_at ? Date.parse(step.ended_at) : active ? now : start
    segments.push({ action: step.action, start, end: Math.max(start, end), planned: false })
  }

  let harvest: Timeline['harvest'] = null
  // upcoming[0] is the current step. The last entry is harvest.
  const next = upcoming[1]
  if (active && next) {
    const delay = Math.max(0, now - Date.parse(next.earliest_start))
    const at = (iso: string) => Date.parse(iso) + delay

    const current = upcoming[0]
    if (current && at(next.earliest_start) > now) {
      segments.push({ action: current.action, start: now, end: at(next.earliest_start), planned: true })
    }
    for (let index = 1; index < upcoming.length - 1; index++) {
      const step = upcoming[index]
      const start = at(step.earliest_start)
      const end = at(upcoming[index + 1].earliest_start)
      if (end > start) segments.push({ action: step.action, start, end, planned: true })
    }
    const last = upcoming[upcoming.length - 1]
    harvest = { start: at(last.earliest_start), end: at(last.latest_start) }
  }

  const start = segments[0]?.start ?? Date.parse(batch.started_at)
  const end = Math.max(start, harvest?.end ?? -Infinity, ...segments.map((segment) => segment.end))
  return { entry, segments, harvest, start, end }
}

export type Week = { days: Date[]; start: number; end: number }

/** The weeks that cover `month`, Monday to Sunday, in local time. */
export function monthWeeks(month: Date): Week[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  // getDay() is 0 for Sunday. Monday starts the week.
  const day = new Date(first)
  day.setDate(first.getDate() - ((first.getDay() + 6) % 7))

  const weeks: Week[] = []
  while (day <= last) {
    const days = Array.from(
      { length: 7 },
      (_, index) => new Date(day.getFullYear(), day.getMonth(), day.getDate() + index),
    )
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 7)
    weeks.push({ days, start: days[0].getTime(), end: end.getTime() })
    day.setTime(end.getTime())
  }
  return weeks
}

export type Placed = {
  timeline: Timeline
  lane: number
  /** Where the bar starts and ends in the week, from 0 to 1. */
  left: number
  right: number
  /** The batch started before this week or ends after it. */
  continuesBefore: boolean
  continuesAfter: boolean
}

/**
 * The bars for one week, each in the first lane that's free where it starts. Bars keep a small
 * gap so two batches in a row don't read as one.
 */
export function placeWeek(timelines: Timeline[], week: Week): { bars: Placed[]; lanes: number } {
  const length = week.end - week.start
  const gap = 0.01
  const laneEnds: number[] = []
  const bars: Placed[] = []

  const visible = timelines
    .filter((line) => line.end > week.start && line.start < week.end)
    .sort((a, b) => a.start - b.start)

  for (const line of visible) {
    const left = Math.max(0, (line.start - week.start) / length)
    // A batch that just started still gets a bar wide enough to tap.
    const right = Math.min(1, Math.max((line.end - week.start) / length, left + 0.05))
    let lane = laneEnds.findIndex((end) => end + gap <= left)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = right
    bars.push({
      timeline: line,
      lane,
      left,
      right,
      continuesBefore: line.start < week.start,
      continuesAfter: line.end > week.end,
    })
  }

  return { bars, lanes: laneEnds.length }
}
