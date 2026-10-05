import {
  ArrowDown,
  ArrowUp,
  Droplet,
  Droplets,
  Leaf,
  Moon,
  Plus,
  Scissors,
  SprayCan,
  Sprout,
  Sun,
  Trash2,
  Waves,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { CareAction } from '@/lib/api'
import {
  type CareDraft,
  type GrowAction,
  newCare,
  newStep,
  type PlantDraft,
  type ProblemLookup,
  type StepDraft,
} from '@/lib/plantDraft'
import { describeSpan, parseSpan } from '@/lib/span'
import { cn } from '@/lib/utils'
import { Segmented } from './Segmented'

const growActions = [
  { value: 'soak', label: 'Soak', icon: Waves },
  { value: 'sprout', label: 'Sprout', icon: Sprout },
  { value: 'blackout', label: 'Blackout', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
] satisfies { value: GrowAction; label: string; icon: typeof Waves }[]

const careActions = [
  { value: 'rinse', label: 'Rinse', icon: Droplets },
  { value: 'water', label: 'Water', icon: Droplet },
  { value: 'mist', label: 'Mist', icon: SprayCan },
] satisfies { value: CareAction; label: string; icon: typeof Waves }[]

export function PlantEditor({
  draft,
  onChange,
  problemAt,
}: {
  draft: PlantDraft
  onChange: (draft: PlantDraft) => void
  problemAt: ProblemLookup
}) {
  const set = (patch: Partial<PlantDraft>) => onChange({ ...draft, ...patch })

  const setStep = (id: string, patch: Partial<StepDraft>) =>
    set({ steps: draft.steps.map((step) => (step.id === id ? { ...step, ...patch } : step)) })

  const moveStep = (index: number, by: -1 | 1) => {
    const steps = [...draft.steps]
    const [step] = steps.splice(index, 1)
    steps.splice(index + by, 0, step)
    set({ steps })
  }

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Basics">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" problem={problemAt('name')}>
            <Input value={draft.name} onChange={(event) => set({ name: event.target.value })} />
          </Field>
          <Field label="Latin name" hint="Optional" problem={problemAt('name_lat')}>
            <Input
              value={draft.nameLat}
              onChange={(event) => set({ nameLat: event.target.value })}
              placeholder="Vigna radiata"
              className="italic"
            />
          </Field>
          <Field label="Kind">
            <Segmented
              label="Kind"
              value={draft.kind}
              onChange={(kind) => set({ kind })}
              options={[
                { value: 'sprout', label: 'Sprout', icon: Sprout },
                { value: 'microgreen', label: 'Microgreen', icon: Leaf },
              ]}
            />
          </Field>
          <Field
            label={draft.kind === 'sprout' ? 'Seed per jar' : 'Seed per tray'}
            hint="Grams, optional"
            problem={problemAt('seed_g')}
          >
            <Input
              type="number"
              min={1}
              value={draft.seedG}
              onChange={(event) => set({ seedG: event.target.value })}
              className="w-32"
            />
          </Field>
        </div>
      </Panel>

      <Panel title="Steps">
        <p className="-mt-2 text-sm">
          The batch moves through these in order. You advance it by hand, with a reminder at the
          shortest time and a warning after the longest.
        </p>
        {problemAt('steps') && <FieldProblem>{problemAt('steps')}</FieldProblem>}
        <ol className="flex flex-col gap-4">
          {draft.steps.map((step, index) => (
            <StepCard
              key={step.id}
              step={step}
              index={index}
              count={draft.steps.length}
              onChange={(patch) => setStep(step.id, patch)}
              onMove={(by) => moveStep(index, by)}
              onRemove={() => set({ steps: draft.steps.filter((other) => other.id !== step.id) })}
              problemAt={(field) => problemAt(`steps[${index}]${field}`)}
            />
          ))}
          <li>
            <Button
              type="button"
              variant="neutral"
              onClick={() => set({ steps: [...draft.steps, newStep()] })}
            >
              <Plus /> Add a step
            </Button>
          </li>
          <li className="flex items-center gap-3 rounded-base border-2 border-dashed border-border bg-secondary-background p-3">
            <span className="grid size-10 place-items-center rounded-base border-2 border-border bg-due">
              <Scissors className="size-5" />
            </span>
            <div>
              <p className="font-heading">Harvest</p>
              <p className="text-sm">Always the last step. Advancing into it ends the batch.</p>
            </div>
          </li>
        </ol>
      </Panel>
    </div>
  )
}

function StepCard({
  step,
  index,
  count,
  onChange,
  onMove,
  onRemove,
  problemAt,
}: {
  step: StepDraft
  index: number
  count: number
  onChange: (patch: Partial<StepDraft>) => void
  onMove: (by: -1 | 1) => void
  onRemove: () => void
  problemAt: (field: string) => string | undefined
}) {
  const setCare = (id: string, patch: Partial<CareDraft>) =>
    onChange({ care: step.care.map((care) => (care.id === id ? { ...care, ...patch } : care)) })

  const unusedCare = careActions.find(
    (option) => !step.care.some((care) => care.action === option.value),
  )

  return (
    <li className="flex flex-col gap-4 rounded-base border-2 border-border bg-secondary-background p-4 shadow-shadow">
      <div className="flex items-center justify-between gap-2">
        <span className="grid size-8 place-items-center rounded-full border-2 border-border bg-main font-heading">
          {index + 1}
        </span>
        <div className="flex gap-1">
          <IconButton label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp />
          </IconButton>
          <IconButton label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown />
          </IconButton>
          <IconButton label="Remove step" onClick={onRemove}>
            <Trash2 />
          </IconButton>
        </div>
      </div>

      <Field label="What happens" problem={problemAt('.action')}>
        <Segmented
          label="Step action"
          value={step.action}
          onChange={(action) => onChange({ action })}
          options={growActions}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <DurationField
          label="Shortest"
          value={step.min}
          onChange={(min) => onChange({ min })}
          problem={problemAt('.duration_min')}
          placeholder="8h"
        />
        <DurationField
          label="Longest"
          hint="Optional"
          value={step.max}
          onChange={(max) => onChange({ max })}
          problem={problemAt('.duration_max')}
          placeholder="12h"
        />
      </div>

      <Field label="Chores during this step">
        <ul className="flex flex-col gap-2">
          {step.care.map((care, careIndex) => (
            <li key={care.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  label="Chore"
                  value={care.action}
                  onChange={(action) => setCare(care.id, { action })}
                  options={careActions}
                />
                <span className="font-heading text-sm">every</span>
                <Input
                  value={care.every}
                  onChange={(event) => setCare(care.id, { every: event.target.value })}
                  aria-label="Every"
                  className={cn('h-9 w-24', parseSpan(care.every) === null && 'border-overdue')}
                />
                <IconButton
                  label="Remove chore"
                  onClick={() => onChange({ care: step.care.filter((other) => other.id !== care.id) })}
                >
                  <X />
                </IconButton>
              </div>
              {problemAt(`.care[${careIndex}].action`) && (
                <FieldProblem>{problemAt(`.care[${careIndex}].action`)}</FieldProblem>
              )}
            </li>
          ))}
          {unusedCare && (
            <li>
              <Button
                type="button"
                variant="neutral"
                size="sm"
                onClick={() => onChange({ care: [...step.care, newCare(unusedCare.value)] })}
              >
                <Plus /> Add a chore
              </Button>
            </li>
          )}
        </ul>
      </Field>

      <Field label="Note" hint="Optional, shown on the batch page">
        <Textarea
          value={step.note}
          onChange={(event) => onChange({ note: event.target.value })}
          rows={2}
          placeholder="Weigh the seeds down with a second tray."
        />
      </Field>
    </li>
  )
}

function DurationField({
  label,
  hint,
  value,
  onChange,
  problem,
  placeholder,
}: {
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  problem?: string
  placeholder: string
}) {
  const parsed = parseSpan(value)
  const invalid = value.trim() !== '' && parsed === null

  return (
    <Field label={label} hint={hint} problem={problem}>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-invalid={invalid}
        className={cn(invalid && 'border-overdue')}
      />
      <p className="text-xs">
        {invalid
          ? 'Use a number and a unit, like 30m, 12h, 4d, or 1d 12h.'
          : parsed !== null
            ? describeSpan(parsed)
            : ' '}
      </p>
    </Field>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl">{title}</h2>
      {children}
    </section>
  )
}

function Field({
  label,
  hint,
  problem,
  children,
}: {
  label: string
  hint?: string
  problem?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-heading">
        {label}
        {hint && <span className="ml-2 font-base text-xs">{hint}</span>}
      </p>
      {children}
      {problem && <FieldProblem>{problem}</FieldProblem>}
    </div>
  )
}

function FieldProblem({ children }: { children: ReactNode }) {
  return (
    <p className="w-fit rounded-base border-2 border-border bg-overdue px-2 py-0.5 text-xs font-heading">
      {children}
    </p>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      variant="neutral"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
