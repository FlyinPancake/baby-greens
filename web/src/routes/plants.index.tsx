import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { Card, ErrorMessage, inputClass, SectionTitle, secondaryButtonClass } from '../components/ui'
import { type LibraryEntry, plantsQuery } from '../lib/api'

export const Route = createFileRoute('/plants/')({
  component: Plants,
})

const sourceLabels: Record<LibraryEntry['source'], string | null> = {
  builtin: null,
  custom: 'custom',
  override: 'customized',
}

function Plants() {
  const plants = useQuery(plantsQuery)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <SectionTitle>Plant library</SectionTitle>
        <ErrorMessage error={plants.error} />
        {plants.isPending ? (
          <p className="text-stone-500">Loading...</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {plants.data
              ?.slice()
              .sort((a, b) => a.plant.name.localeCompare(b.plant.name))
              .map((entry) => (
                <li key={entry.slug}>
                  <Link
                    to="/plants/$slug"
                    params={{ slug: entry.slug }}
                    className="flex items-center justify-between gap-3 py-3 hover:bg-stone-50"
                  >
                    <div>
                      <p className="font-medium">{entry.plant.name}</p>
                      {entry.plant.name_lat && (
                        <p className="text-sm text-stone-500 italic">{entry.plant.name_lat}</p>
                      )}
                    </div>
                    {sourceLabels[entry.source] && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                        {sourceLabels[entry.source]}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </Card>
      <AddPlant />
    </div>
  )
}

function AddPlant() {
  const navigate = useNavigate()
  const [slug, setSlug] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    void navigate({ to: '/plants/$slug', params: { slug } })
  }

  return (
    <Card>
      <SectionTitle>Add a plant</SectionTitle>
      <form onSubmit={submit} className="flex gap-2">
        <input
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          maxLength={64}
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          placeholder="my-pea-mix"
          title="Lowercase letters, digits, and single hyphens"
          className={inputClass}
        />
        <button type="submit" className={secondaryButtonClass}>
          Create
        </button>
      </form>
    </Card>
  )
}
