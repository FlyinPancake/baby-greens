import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { buttonClass, Card, ErrorMessage, inputClass, SectionTitle } from '../components/ui'
import { api, type LibraryEntry, plantsQuery, unwrap } from '../lib/api'
import { toLocalInput } from '../lib/time'

export const Route = createFileRoute('/batches/new')({
  component: NewBatch,
})

function NewBatch() {
  const plants = useQuery(plantsQuery)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [plantSlug, setPlantSlug] = useState('')
  const [container, setContainer] = useState('')
  const [seedG, setSeedG] = useState('')
  const [startedAt, setStartedAt] = useState(() => toLocalInput(new Date()))
  const [latestStart] = useState(startedAt)
  const [notes, setNotes] = useState('')

  const selected = plants.data?.find((entry) => entry.slug === plantSlug)

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/batches', {
          body: {
            plant_slug: plantSlug,
            container,
            seed_g: seedG === '' ? null : Number(seedG),
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

  function submit(event: FormEvent) {
    event.preventDefault()
    create.mutate()
  }

  return (
    <Card>
      <SectionTitle>Start a batch</SectionTitle>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Plant</span>
          <select
            required
            value={plantSlug}
            onChange={(event) => setPlantSlug(event.target.value)}
            className={inputClass}
          >
            <option value="" disabled>
              {plants.isPending ? 'Loading plants...' : 'Pick a plant'}
            </option>
            <PlantOptions label="Sprouts" entries={plants.data} kind="sprout" />
            <PlantOptions label="Microgreens" entries={plants.data} kind="microgreen" />
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Jar or tray</span>
          <input
            required
            value={container}
            onChange={(event) => setContainer(event.target.value)}
            placeholder="jar 2"
            className={inputClass}
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Seed (g)</span>
            <input
              type="number"
              min={1}
              value={seedG}
              onChange={(event) => setSeedG(event.target.value)}
              placeholder={selected?.plant.seed_g?.toString() ?? ''}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Started</span>
            <input
              type="datetime-local"
              required
              value={startedAt}
              max={latestStart}
              onChange={(event) => setStartedAt(event.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Notes</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            className={inputClass}
          />
        </label>

        <ErrorMessage error={create.error} />
        <button type="submit" disabled={create.isPending} className={buttonClass}>
          Start
        </button>
      </form>
    </Card>
  )
}

function PlantOptions({
  label,
  entries,
  kind,
}: {
  label: string
  entries: LibraryEntry[] | undefined
  kind: 'sprout' | 'microgreen'
}) {
  const matching = (entries ?? [])
    .filter((entry) => entry.plant.kind === kind)
    .sort((a, b) => a.plant.name.localeCompare(b.plant.name))

  return (
    <optgroup label={label}>
      {matching.map((entry) => (
        <option key={entry.slug} value={entry.slug}>
          {entry.plant.name}
        </option>
      ))}
    </optgroup>
  )
}
