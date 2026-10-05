import type { StepAction, TaskAction } from './api'

/** What the batch is doing while it's in a step. */
export const stepLabels: Record<StepAction, string> = {
  soak: 'Soaking',
  sprout: 'Sprouting',
  blackout: 'In blackout',
  light: 'Under light',
  harvest: 'Harvested',
}

/** What to do when moving into a step. */
const advanceLabels: Record<StepAction, string> = {
  soak: 'Start soaking',
  sprout: 'Drain the soak water',
  blackout: 'Sow and cover',
  light: 'Uncover and move into light',
  harvest: 'Harvest',
}

const careLabels = {
  rinse: 'Rinse and drain',
  water: 'Water',
  mist: 'Mist',
} as const

export function taskLabel(task: TaskAction): string {
  return task.kind === 'advance' ? advanceLabels[task.action] : careLabels[task.action]
}

/** A step's name in a plant's step list. */
export const stepNames: Record<StepAction, string> = {
  soak: 'Soak',
  sprout: 'Sprout',
  blackout: 'Blackout',
  light: 'Light',
  harvest: 'Harvest',
}
