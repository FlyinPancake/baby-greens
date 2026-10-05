import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Minus, Plus, Sprout } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { ContainerPicker } from '@/components/ContainerPicker'
import { ColorDot } from '@/components/ContainerColor'
import { ErrorAlert } from '@/components/ErrorAlert'
import { MobileActionBar } from '@/components/MobileActionBar'
import { Highlight, PageHeading } from '@/components/PageHeading'
import { PlantPicker } from '@/components/PlantPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { api, containersQuery, type LibraryEntry, plantsQuery, unwrap } from '@/lib/api'
import { stepIcons } from '@/lib/icons'
import { stepNames } from '@/lib/labels'
import { planSteps } from '@/lib/plan'
import { formatWhen, formatWindow, toLocalInput } from '@/lib/time'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/batches/new')({
  validateSearch: (search: Record<string, unknown>): { plant?: string; container?: string } => ({
    ...(typeof search.plant === 'string' ? { plant: search.plant } : {}),
    ...(typeof search.container === 'string' ? { container: search.container } : {}),
  }),
  component: NewBatch,
})

type StartPreset = { label: string; at: () => Date }

const startPresets: StartPreset[] = [
  { label: 'Now', at: () => new Date() },
  { label: '1 hour ago', at: () => new Date(Date.now() - 60 * 60 * 1000) },
  {
    label: 'This morning',
    at: () => {
      const morning = new Date()
      morning.setHours(8, 0, 0, 0)
      return morning
    },
  },
  {
    label: 'Last night',
    at: () => {
      const night = new Date()
      night.setDate(night.getDate() - 1)
      night.setHours(21, 0, 0, 0)
      return night
    },
  },
]

function NewBatch() {
  const search = Route.useSearch()
  const plants = useQuery(plantsQuery)
  const containers = useQuery(containersQuery)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [plantSlug, setPlantSlug] = useState<string | null>(search.plant ?? null)
  const [containerId, setContainerId] = useState<string | null>(search.container ?? null)
  const [seed, setSeed] = useState<number | null>(null)
  const [startedAt, setStartedAt] = useState(() => toLocalInput(new Date()))
  const [startLabel, setStartLabel] = useState<string | null>('Now')
  const [latestStart] = useState(startedAt)
  const [notes, setNotes] = useState('')

  const entry = plants.data?.find((candidate) => candidate.slug === plantSlug)
  const seedG = seed ?? entry?.plant.seed_g ?? null
  // A container picked earlier, or passed in the URL, stops counting once it's busy or archived.
  const container = containers.data?.find(
    (candidate) =>
      candidate.id === containerId && !candidate.archived_at && candidate.occupant == null,
  )

  function pickPlant(slug: string) {
    setPlantSlug(slug)
    setSeed(null)
  }

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/batches', {
          body: {
            plant_slug: plantSlug ?? '',
            container_id: container?.id ?? '',
            seed_g: seedG,
            started_at: new Date(startedAt).toISOString(),
            notes,
          },
        }),
      ),
    onSuccess: async (batch) => {
      await queryClient.invalidateQueries({ queryKey: ['batches'] })
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
      await navigate({ to: '/batches/$id', params: { id: batch.batch.id } })
    },
  })

  const harvest = entry ? planSteps(entry.plant, new Date(startedAt))?.at(-1) : undefined
  const ready = entry != null && container != null && seedG !== null && seedG > 0

  return (
    <div className="flex flex-col gap-6 pb-24 lg:pb-0">
      <PageHeading>
        Start a <Highlight>batch</Highlight>
      </PageHeading>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          <Section number={1} title="Pick a plant">
            <ErrorAlert error={plants.error} />
            {plants.data ? (
              <PlantPicker entries={plants.data} value={plantSlug} onChange={pickPlant} />
            ) : (
              <p className="font-heading">Loading plants...</p>
            )}
          </Section>

          <Section number={2} title="Set it up" muted={!entry}>
            <Question label="Which jar or tray?">
              <ErrorAlert error={containers.error} />
              {containers.data ? (
                <ContainerPicker
                  containers={containers.data}
                  value={container?.id ?? null}
                  onChange={setContainerId}
                  preferredKind={entry?.plant.kind === 'microgreen' ? 'tray' : 'jar'}
                />
              ) : (
                <p className="font-heading">Loading jars and trays...</p>
              )}
            </Question>

            <Question label="How much seed?">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="neutral"
                  size="icon"
                  aria-label="Less seed"
                  onClick={() => setSeed(Math.max(1, (seedG ?? 10) - 5))}
                >
                  <Minus />
                </Button>
                <div className="flex h-10 items-center gap-1 rounded-base border-2 border-border bg-secondary-background px-3">
                  <input
                    type="number"
                    min={1}
                    value={seedG ?? ''}
                    onChange={(event) =>
                      setSeed(event.target.value === '' ? null : Number(event.target.value))
                    }
                    aria-label="Seed in grams"
                    className="w-14 bg-transparent text-right font-heading text-lg outline-none"
                  />
                  <span className="font-heading">g</span>
                </div>
                <Button
                  type="button"
                  variant="neutral"
                  size="icon"
                  aria-label="More seed"
                  onClick={() => setSeed((seedG ?? 0) + 5)}
                >
                  <Plus />
                </Button>
                {entry?.plant.seed_g && seed !== null && seed !== entry.plant.seed_g && (
                  <button
                    type="button"
                    onClick={() => setSeed(null)}
                    className="text-sm underline decoration-2 underline-offset-2"
                  >
                    back to {entry.plant.seed_g} g
                  </button>
                )}
              </div>
            </Question>

            <Question label="When did it start?">
              <div className="flex flex-wrap gap-2">
                {startPresets.map((preset) => (
                  <Chip
                    key={preset.label}
                    selected={startLabel === preset.label}
                    onClick={() => {
                      setStartLabel(preset.label)
                      setStartedAt(toLocalInput(preset.at()))
                    }}
                  >
                    {preset.label}
                  </Chip>
                ))}
                <Input
                  type="datetime-local"
                  value={startedAt}
                  max={latestStart}
                  onChange={(event) => {
                    setStartLabel(null)
                    setStartedAt(event.target.value)
                  }}
                  aria-label="Start time"
                  className="h-9 w-auto"
                />
              </div>
            </Question>

            <Question label="Anything to remember?">
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                placeholder="New seed supplier, trying a thicker sow..."
              />
            </Question>
          </Section>
        </div>

        <Ticket
          entry={entry}
          container={container?.name ?? ''}
          containerColor={container?.color ?? null}
          seedG={seedG}
          startedAt={new Date(startedAt)}
          ready={ready}
          error={create.error}
          pending={create.isPending}
          onStart={() => create.mutate()}
        />
      </div>

      <MobileActionBar>
        <div className="min-w-0 text-sm">
          <p className="truncate font-heading">{entry?.plant.name ?? 'Pick a plant'}</p>
          <p className="truncate">
            {harvest
              ? `harvest ${formatWindow(harvest.earliest.toISOString(), harvest.latest.toISOString())}`
              : entry
                ? 'pick a jar or tray'
                : 'to see its schedule'}
          </p>
        </div>
        <Button onClick={() => create.mutate()} disabled={!ready || create.isPending}>
          <Sprout /> Start
        </Button>
      </MobileActionBar>
    </div>
  )
}

function Section({
  number,
  title,
  muted = false,
  children,
}: {
  number: number
  title: string
  muted?: boolean
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-5 rounded-base border-2 border-border bg-secondary-background p-5 shadow-shadow transition-opacity',
        muted && 'pointer-events-none opacity-50',
      )}
      aria-disabled={muted}
    >
      <h2 className="flex items-center gap-3 text-xl">
        <span className="grid size-8 place-items-center rounded-full border-2 border-border bg-main font-heading">
          {number}
        </span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Question({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-heading">{label}</p>
      {children}
    </div>
  )
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-base border-2 border-border px-3 text-sm font-heading transition-all',
        selected ? 'bg-main shadow-shadow' : 'bg-background hover:-translate-y-0.5',
      )}
    >
      {children}
    </button>
  )
}

/** The live summary beside the form, with the planned schedule and the start button. */
function Ticket({
  entry,
  container,
  containerColor,
  seedG,
  startedAt,
  ready,
  error,
  pending,
  onStart,
}: {
  entry: LibraryEntry | undefined
  container: string
  containerColor: string | null
  seedG: number | null
  startedAt: Date
  ready: boolean
  error: Error | null
  pending: boolean
  onStart: () => void
}) {
  const planned = entry ? planSteps(entry.plant, startedAt) : null
  const harvest = planned?.at(-1)

  return (
    <aside className="flex flex-col gap-4 rounded-base border-2 border-border bg-secondary-background p-5 shadow-shadow lg:sticky lg:top-24">
      <p className="text-xs font-heading tracking-widest uppercase">Grow ticket</p>
      {entry ? (
        <>
          <div>
            <p className="text-2xl font-heading leading-tight">{entry.plant.name}</p>
            <p className="flex items-center gap-1.5 text-sm">
              {containerColor && <ColorDot color={containerColor} />}
              {container.trim() || 'pick a jar or tray'} · {seedG ? `${seedG} g` : 'no seed amount'}
            </p>
          </div>

          <ol className="flex flex-col gap-2 border-y-2 border-dashed border-border py-3">
            {planned?.map((step, index) => {
              const Icon = stepIcons[step.action]
              return (
                <li key={index} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2 font-heading">
                    <Icon className="size-4" />
                    {stepNames[step.action]}
                  </span>
                  <span>
                    {index === 0
                      ? formatWhen(step.earliest.toISOString())
                      : formatWindow(step.earliest.toISOString(), step.latest.toISOString())}
                  </span>
                </li>
              )
            })}
          </ol>

          {harvest && (
            <div className="-rotate-1 rounded-base border-2 border-border bg-main p-3 shadow-shadow">
              <p className="text-xs font-heading tracking-wide uppercase">Harvest</p>
              <p className="text-2xl font-heading">
                {formatWindow(harvest.earliest.toISOString(), harvest.latest.toISOString())}
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="border-y-2 border-dashed border-border py-6 text-center font-heading">
          Pick a plant to see its schedule.
        </p>
      )}

      <ErrorAlert error={error} />
      <Button size="lg" onClick={onStart} disabled={!ready || pending}>
        <Sprout /> Start growing
      </Button>
    </aside>
  )
}
