// An editable copy of a plant definition. Inputs hold strings, so a half-typed duration stays
// in the field instead of being rejected. `toPlant` turns a draft back into the API shape.

import type { CareAction, Plant, Problem, StepAction } from './api'

export type GrowAction = Exclude<StepAction, 'harvest'>

export type CareDraft = { id: string; action: CareAction; every: string }

export type LinkDraft = { id: string; label: string; url: string }

export type StepDraft = {
  id: string
  action: GrowAction
  min: string
  max: string
  note: string
  care: CareDraft[]
}

export type PlantDraft = {
  name: string
  nameLat: string
  kind: Plant['kind']
  seedG: string
  /** Every step before the final harvest step, which the editor always adds back. */
  steps: StepDraft[]
  links: LinkDraft[]
}

const newId = () => crypto.randomUUID()

export function newCare(action: CareAction = 'rinse'): CareDraft {
  return { id: newId(), action, every: '12h' }
}

export function newLink(): LinkDraft {
  return { id: newId(), label: '', url: '' }
}

export function newStep(action: GrowAction = 'sprout'): StepDraft {
  return { id: newId(), action, min: '1d', max: '', note: '', care: [] }
}

export function fromPlant(plant: Plant): PlantDraft {
  return {
    name: plant.name,
    nameLat: plant.name_lat ?? '',
    kind: plant.kind,
    seedG: plant.seed_g?.toString() ?? '',
    steps: plant.steps
      .filter((step) => step.action !== 'harvest')
      .map((step) => ({
        id: newId(),
        action: step.action as GrowAction,
        min: step.duration_min ?? '',
        max: step.duration_max ?? '',
        note: step.note ?? '',
        care: (step.care ?? []).map((care) => ({
          id: newId(),
          action: care.action,
          every: care.every,
        })),
      })),
    links: (plant.links ?? []).map((link) => ({ id: newId(), ...link })),
  }
}

export function toPlant(draft: PlantDraft): Plant {
  const optional = (text: string) => (text.trim() === '' ? undefined : text.trim())
  const seed = draft.seedG.trim() === '' ? undefined : Number(draft.seedG)

  return {
    name: draft.name.trim(),
    name_lat: optional(draft.nameLat),
    kind: draft.kind,
    seed_g: seed,
    steps: [
      ...draft.steps.map((step) => ({
        action: step.action,
        duration_min: optional(step.min),
        duration_max: optional(step.max),
        note: optional(step.note),
        care:
          step.care.length > 0
            ? step.care.map((care) => ({ action: care.action, every: care.every.trim() }))
            : undefined,
      })),
      { action: 'harvest' as const },
    ],
    links:
      draft.links.length > 0
        ? draft.links.map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
        : undefined,
  }
}

/** A starting point for a new plant, named after its slug. */
export function draftForSlug(slug: string): PlantDraft {
  const name = slug.replace(/-/g, ' ')
  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    nameLat: '',
    kind: 'sprout',
    seedG: '30',
    steps: [
      { ...newStep('soak'), min: '8h', max: '12h' },
      { ...newStep('sprout'), min: '3d', max: '5d', care: [newCare('rinse')] },
    ],
    links: [],
  }
}

/** Finds the server's problem for a field, by the path it reports, like `steps[1].duration_max`. */
export type ProblemLookup = (path: string) => string | undefined

export function lookupProblems(problems: Problem[]): ProblemLookup {
  const byPath = new Map(problems.map((problem) => [problem.path, problem.message]))
  return (path) => byPath.get(path)
}
