import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { stepIcons } from '@/lib/icons'
import { Highlight, PageHeading } from '@/components/PageHeading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type LibraryEntry, plantsQuery } from '@/lib/api'
import { formatRange } from '@/lib/time'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/plants/')({
  component: Plants,
})

type Filter = 'all' | 'sprout' | 'microgreen'

const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'sprout', label: 'Sprouts' },
  { value: 'microgreen', label: 'Microgreens' },
]

function Plants() {
  const plants = useQuery(plantsQuery)
  const [filter, setFilter] = useState<Filter>('all')

  const shown = (plants.data ?? [])
    .filter((entry) => filter === 'all' || entry.plant.kind === filter)
    .sort((a, b) => a.plant.name.localeCompare(b.plant.name))

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeading>
        Plant <Highlight>library</Highlight>
      </PageHeading>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter plants">
        {filters.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={cn(
              'rounded-base border-2 border-border px-3 py-1.5 text-sm font-heading transition-all',
              filter === option.value ? 'bg-main shadow-shadow' : 'bg-secondary-background hover:bg-main',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <ErrorAlert error={plants.error} />
      {plants.isPending ? (
        <p className="font-heading">Loading...</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {shown.map((entry) => (
            <PlantCard key={entry.slug} entry={entry} />
          ))}
        </ul>
      )}

      <AddPlant />
    </div>
  )
}

const stickers: Record<LibraryEntry['source'], string | null> = {
  builtin: null,
  custom: 'custom',
  override: 'customized',
}

function PlantCard({ entry }: { entry: LibraryEntry }) {
  const { plant } = entry
  const sticker = stickers[entry.source]

  return (
    <li className="relative min-w-0">
      {sticker && (
        <Badge className="absolute -top-3 -right-2 z-10 rotate-6 bg-chart-5 font-heading text-white shadow-shadow">
          {sticker}
        </Badge>
      )}
      <Link
        to="/plants/$slug"
        params={{ slug: entry.slug }}
        className="flex h-full flex-col gap-3 rounded-base border-2 border-border bg-secondary-background p-4 shadow-shadow transition-all hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-heading text-lg">{plant.name}</p>
            {plant.name_lat && <p className="truncate text-sm italic">{plant.name_lat}</p>}
          </div>
          <Badge className={plant.kind === 'sprout' ? 'bg-due' : 'bg-chart-3 text-white'}>
            {plant.kind}
          </Badge>
        </div>
        <ol className="flex flex-wrap gap-1.5 text-xs">
          {plant.steps.map((step, index) => {
            const Icon = stepIcons[step.action]
            return (
              <li
                key={index}
                className="flex items-center gap-1 rounded-base border-2 border-border bg-background px-1.5 py-0.5"
              >
                <Icon className="size-3.5" />
                {step.duration_min ? formatRange(step.duration_min, step.duration_max) : 'harvest'}
              </li>
            )
          })}
        </ol>
      </Link>
    </li>
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
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-base border-2 border-dashed border-border p-4"
    >
      <p className="font-heading">Add your own plant</p>
      <div className="flex gap-2">
        <Input
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          maxLength={64}
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          placeholder="my-pea-mix"
          title="Lowercase letters, digits, and single hyphens"
          aria-label="Slug for the new plant"
        />
        <Button type="submit">
          <Plus /> Create
        </Button>
      </div>
    </form>
  )
}
