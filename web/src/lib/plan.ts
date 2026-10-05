import type { Plant, StepAction } from './api'
import { parseSpan } from './span'

export type PlannedStep = { action: StepAction; earliest: Date; latest: Date }

/**
 * When each step should start for a batch started at `start`, mirroring the server's timeline.
 * Returns null if a duration doesn't parse.
 */
export function planSteps(plant: Plant, start: Date): PlannedStep[] | null {
  let earliest = start.getTime()
  let latest = start.getTime()
  const planned: PlannedStep[] = []

  for (const step of plant.steps) {
    planned.push({ action: step.action, earliest: new Date(earliest), latest: new Date(latest) })
    if (!step.duration_min) continue
    const min = parseSpan(step.duration_min)
    const max = step.duration_max ? parseSpan(step.duration_max) : min
    if (min === null || max === null) return null
    earliest += min
    latest += max
  }

  return planned
}

/** The shortest and longest time from start to harvest, in milliseconds. */
export function growRange(plant: Plant): { min: number; max: number } | null {
  const planned = planSteps(plant, new Date(0))
  const harvest = planned?.at(-1)
  return harvest ? { min: harvest.earliest.getTime(), max: harvest.latest.getTime() } : null
}
