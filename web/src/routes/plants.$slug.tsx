import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Braces, Leaf, PencilRuler, RotateCcw, Save, Sprout, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { MobileActionBar } from '@/components/MobileActionBar'
import { PlantEditor } from '@/components/PlantEditor'
import { PlantLinks } from '@/components/PlantLinks'
import { PlantResults } from '@/components/PlantResults'
import { Segmented } from '@/components/Segmented'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, api, type LibraryEntry, type Plant, plantQuery, unwrap } from '@/lib/api'
import { stepIcons } from '@/lib/icons'
import { stepNames } from '@/lib/labels'
import { growRange } from '@/lib/plan'
import { draftForSlug, fromPlant, lookupProblems, type PlantDraft, toPlant } from '@/lib/plantDraft'
import { describeRange } from '@/lib/span'
import { formatRange } from '@/lib/time'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/plants/$slug')({
  component: PlantPage,
})

function PlantPage() {
  const { slug } = Route.useParams()
  const plant = useQuery(plantQuery(slug))
  const notFound = plant.error instanceof ApiError && plant.error.status === 404

  return (
    <div className="flex flex-col gap-6">
      <Link to="/plants" className="flex w-fit items-center gap-1 font-heading hover:underline">
        <ArrowLeft className="size-4" /> Plant library
      </Link>
      {plant.isPending ? (
        <p className="font-heading">Loading...</p>
      ) : plant.isError && !notFound ? (
        <ErrorAlert error={plant.error} />
      ) : (
        // Remount when the saved plant changes, so the editor starts from the saved version.
        <PlantWorkbench key={JSON.stringify(plant.data?.plant)} slug={slug} entry={plant.data} />
      )}
    </div>
  )
}

const sourceLabels: Record<LibraryEntry['source'], string> = {
  builtin: 'built in',
  custom: 'custom',
  override: 'customized',
}

const sourceDescriptions: Record<LibraryEntry['source'], string> = {
  builtin: 'Built in. Saving makes a customized copy for everyone on this server.',
  custom: 'A custom plant, shared by everyone on this server.',
  override: 'A customized copy of a built-in plant. Restoring brings the built-in one back.',
}

type Mode = 'editor' | 'json'

function PlantWorkbench({ slug, entry }: { slug: string; entry: LibraryEntry | undefined }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [draft, setDraft] = useState<PlantDraft>(() =>
    entry ? fromPlant(entry.plant) : draftForSlug(slug),
  )
  const [baseline] = useState(() => JSON.stringify(toPlant(draft)))
  const [mode, setMode] = useState<Mode>('editor')
  const [json, setJson] = useState('')
  const [jsonError, setJsonError] = useState<Error | null>(null)

  const plant = toPlant(draft)
  const dirty = !entry || JSON.stringify(plant) !== baseline

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['plants'] })

  const save = useMutation({
    mutationFn: (body: Plant) =>
      unwrap(api.PUT('/plants/{slug}', { params: { path: { slug } }, body })),
    onSuccess: refresh,
  })

  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE('/plants/{slug}', { params: { path: { slug } } })),
    onSuccess: async () => {
      await refresh()
      if (entry?.source === 'custom') await navigate({ to: '/plants' })
    },
  })

  /** Reads the JSON tab back into the draft. Returns null and shows the error if it doesn't parse. */
  function applyJson(): Plant | null {
    try {
      const parsed = JSON.parse(json) as Plant
      setDraft(fromPlant(parsed))
      setJsonError(null)
      return parsed
    } catch (error) {
      setJsonError(error as Error)
      return null
    }
  }

  function switchMode(next: Mode) {
    if (next === mode) return
    if (next === 'json') {
      setJson(JSON.stringify(plant, null, 2))
      setMode('json')
    } else if (applyJson()) {
      setMode('editor')
    }
  }

  function submit() {
    const body = mode === 'json' ? applyJson() : plant
    if (body) save.mutate(body)
  }

  const problems = save.error instanceof ApiError ? save.error.problems : []
  const problemAt = lookupProblems(problems)

  const range = growRange(plant)
  const saveLabel = dirty ? 'Save changes' : 'Saved'
  const saveDisabled = save.isPending || (!dirty && mode === 'editor')

  return (
    <div className="grid items-start gap-6 pb-24 lg:grid-cols-[1fr_320px] lg:pb-0">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-4xl tracking-tight">{draft.name || slug}</h1>
            <Badge className="bg-secondary-background font-heading">{slug}</Badge>
            <Badge className="rotate-3 bg-chart-5 font-heading text-white shadow-shadow">
              {entry ? sourceLabels[entry.source] : 'new'}
            </Badge>
          </div>
          <p>{entry ? sourceDescriptions[entry.source] : 'This slug is free. Save to add the plant.'}</p>
        </div>

        <Segmented
          label="Editing mode"
          value={mode}
          onChange={switchMode}
          options={[
            { value: 'editor', label: 'Editor', icon: PencilRuler },
            { value: 'json', label: 'JSON', icon: Braces },
          ]}
        />

        <ErrorAlert error={jsonError} />
        {/* On phones the sidebar sits below the form, so repeat save errors up here. */}
        <div className="lg:hidden">
          <ErrorAlert error={save.error} />
        </div>

        {mode === 'editor' ? (
          <PlantEditor draft={draft} onChange={setDraft} problemAt={problemAt} />
        ) : (
          <div className="rounded-base border-2 border-border bg-secondary-background shadow-shadow">
            <div className="flex items-center gap-2 border-b-2 border-border bg-main px-3 py-2">
              <span className="size-3 rounded-full border-2 border-border bg-overdue" />
              <span className="size-3 rounded-full border-2 border-border bg-due" />
              <span className="size-3 rounded-full border-2 border-border bg-secondary-background" />
              <span className="ml-2 font-heading text-sm">{slug}.json</span>
            </div>
            <Textarea
              value={json}
              onChange={(event) => setJson(event.target.value)}
              spellCheck={false}
              rows={26}
              aria-label="Plant definition JSON"
              className="rounded-none border-0 font-mono text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
        )}
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
        <Preview plant={plant} />
        {entry && <PlantResults slug={slug} />}

        <ErrorAlert error={save.error ?? remove.error} />

        <Button size="lg" onClick={submit} disabled={saveDisabled}>
          <Save /> {saveLabel}
        </Button>
        {entry && (
          <Button
            variant="neutral"
            nativeButton={false}
            render={<Link to="/batches/new" search={{ plant: slug }} />}
          >
            <Sprout /> Grow this
          </Button>
        )}
        {entry && entry.source !== 'builtin' && (
          <Button variant="neutral" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {entry.source === 'override' ? (
              <>
                <RotateCcw /> Restore built-in
              </>
            ) : (
              <>
                <Trash2 /> Delete plant
              </>
            )}
          </Button>
        )}
      </aside>

      <MobileActionBar>
        <div className="min-w-0 text-sm">
          <p className="truncate font-heading">{plant.name || slug}</p>
          <p className="truncate">
            {range ? `ready in ${describeRange(range.min, range.max)}` : 'check the durations'}
          </p>
        </div>
        <Button onClick={submit} disabled={saveDisabled}>
          <Save /> {saveLabel}
        </Button>
      </MobileActionBar>
    </div>
  )
}

/** How the plant will look in the library, updated as you edit. */
function Preview({ plant }: { plant: Plant }) {
  const range = growRange(plant)
  const KindIcon = plant.kind === 'sprout' ? Sprout : Leaf

  return (
    <div className="flex flex-col gap-3 rounded-base border-2 border-border bg-secondary-background p-4 shadow-shadow">
      <p className="text-xs font-heading tracking-widest uppercase">Preview</p>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-base border-2 border-border',
            plant.kind === 'sprout' ? 'bg-due' : 'bg-chart-3 text-white',
          )}
        >
          <KindIcon className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="font-heading text-lg leading-tight">{plant.name || 'Unnamed plant'}</p>
          {plant.name_lat && <p className="truncate text-sm italic">{plant.name_lat}</p>}
        </div>
      </div>
      <div className="-rotate-1 rounded-base border-2 border-border bg-main p-3">
        <p className="text-xs font-heading tracking-wide uppercase">Ready in</p>
        <p className="text-xl font-heading">
          {range ? describeRange(range.min, range.max) : 'check the durations'}
        </p>
      </div>
      <ol className="flex flex-col gap-1.5 text-sm">
        {plant.steps.map((step, index) => {
          const Icon = stepIcons[step.action]
          return (
            <li key={index} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-heading">
                <Icon className="size-4" />
                {stepNames[step.action]}
              </span>
              <span>{formatRange(step.duration_min, step.duration_max)}</span>
            </li>
          )
        })}
      </ol>
      {plant.seed_g && <p className="text-sm">{plant.seed_g} g of seed per {plant.kind === 'sprout' ? 'jar' : 'tray'}</p>}
      <PlantLinks links={plant.links} />
    </div>
  )
}
