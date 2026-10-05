import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import {
  buttonClass,
  Card,
  ErrorMessage,
  inputClass,
  SectionTitle,
  secondaryButtonClass,
} from '../components/ui'
import { ApiError, api, type LibraryEntry, type Plant, plantQuery, unwrap } from '../lib/api'

export const Route = createFileRoute('/plants/$slug')({
  component: PlantPage,
})

const template: Plant = {
  name: 'New plant',
  kind: 'sprout',
  seed_g: 30,
  steps: [
    { action: 'soak', duration_min: '8h', duration_max: '12h' },
    {
      action: 'sprout',
      duration_min: '3d',
      duration_max: '5d',
      care: [{ action: 'rinse', every: '12h' }],
    },
    { action: 'harvest' },
  ],
}

function PlantPage() {
  const { slug } = Route.useParams()
  const plant = useQuery(plantQuery(slug))

  if (plant.isPending) return <p className="text-stone-500">Loading...</p>

  const notFound = plant.error instanceof ApiError && plant.error.status === 404
  if (plant.isError && !notFound) return <ErrorMessage error={plant.error} />

  // Remount the editor when the saved plant changes, so it starts from the new text.
  const entry = plant.data
  return <Editor key={JSON.stringify(entry?.plant)} slug={slug} entry={entry} />
}

const sourceDescriptions: Record<LibraryEntry['source'], string> = {
  builtin: 'Built in. Saving makes a customized copy for everyone on this server.',
  custom: 'A custom plant, shared by everyone on this server.',
  override: 'A customized copy of a built-in plant. Deleting it restores the built-in one.',
}

function Editor({ slug, entry }: { slug: string; entry: LibraryEntry | undefined }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [text, setText] = useState(() => JSON.stringify(entry?.plant ?? template, null, 2))
  const [parseError, setParseError] = useState<Error | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['plants'] })

  const save = useMutation({
    mutationFn: (plant: Plant) =>
      unwrap(api.PUT('/plants/{slug}', { params: { path: { slug } }, body: plant })),
    onSuccess: refresh,
  })

  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE('/plants/{slug}', { params: { path: { slug } } })),
    onSuccess: async () => {
      await refresh()
      if (entry?.source === 'custom') await navigate({ to: '/plants' })
    },
  })

  function submit() {
    setParseError(null)
    try {
      save.mutate(JSON.parse(text) as Plant)
    } catch (error) {
      setParseError(error as Error)
    }
  }

  return (
    <Card>
      <SectionTitle>{entry ? entry.plant.name : `New plant: ${slug}`}</SectionTitle>
      <p className="mb-3 text-sm text-stone-600">
        {entry ? sourceDescriptions[entry.source] : 'This slug is free. Save to add the plant.'}
      </p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        rows={24}
        className={`${inputClass} font-mono text-sm`}
      />
      <div className="mt-3 flex flex-col gap-3">
        <ErrorMessage error={parseError ?? save.error ?? remove.error} />
        {save.isSuccess && <p className="text-sm text-green-800">Saved.</p>}
        <div className="flex justify-between gap-3">
          {entry && entry.source !== 'builtin' ? (
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              className={`${secondaryButtonClass} text-red-700`}
            >
              {entry.source === 'override' ? 'Restore built-in' : 'Delete'}
            </button>
          ) : (
            <span />
          )}
          <button type="button" onClick={submit} disabled={save.isPending} className={buttonClass}>
            Save
          </button>
        </div>
      </div>
    </Card>
  )
}
