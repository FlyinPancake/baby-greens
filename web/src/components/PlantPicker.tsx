import { Check, Leaf, Search, Sprout } from 'lucide-react'
import { useState } from 'react'
import type { LibraryEntry } from '@/lib/api'
import { growRange } from '@/lib/plan'
import { describeRange } from '@/lib/span'
import { cn } from '@/lib/utils'
import { Segmented } from './Segmented'

type Filter = 'all' | 'sprout' | 'microgreen'

/** A searchable grid of plant tiles. Picking a tile chooses that plant. */
export function PlantPicker({
  entries,
  value,
  onChange,
}: {
  entries: LibraryEntry[]
  value: string | null
  onChange: (slug: string) => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const needle = query.trim().toLowerCase()
  const shown = entries
    .filter((entry) => filter === 'all' || entry.plant.kind === filter)
    .filter(
      (entry) =>
        !needle ||
        entry.plant.name.toLowerCase().includes(needle) ||
        entry.plant.name_lat?.toLowerCase().includes(needle),
    )
    .sort((a, b) => a.plant.name.localeCompare(b.plant.name))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-48 flex-1 items-center gap-2 rounded-base border-2 border-border bg-secondary-background px-3 focus-within:ring-2 focus-within:ring-black focus-within:ring-offset-2">
          <Search className="size-4 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search plants"
            aria-label="Search plants"
            className="h-10 w-full bg-transparent text-base outline-none md:text-sm placeholder:text-foreground/50"
          />
        </label>
        <Segmented
          label="Kind"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'sprout', label: 'Sprouts', icon: Sprout },
            { value: 'microgreen', label: 'Microgreens', icon: Leaf },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <p className="rounded-base border-2 border-dashed border-border p-4 text-center font-heading">
          No plant matches "{query}".
        </p>
      ) : (
        <div role="radiogroup" aria-label="Plant" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shown.map((entry) => (
            <PlantTile
              key={entry.slug}
              entry={entry}
              selected={entry.slug === value}
              onSelect={() => onChange(entry.slug)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PlantTile({
  entry,
  selected,
  onSelect,
}: {
  entry: LibraryEntry
  selected: boolean
  onSelect: () => void
}) {
  const { plant } = entry
  const range = growRange(plant)
  const Icon = plant.kind === 'sprout' ? Sprout : Leaf

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'relative flex min-w-0 flex-col items-start gap-2 rounded-base border-2 border-border p-3 text-left transition-all',
        selected
          ? '-translate-y-1 bg-main shadow-shadow'
          : 'bg-secondary-background hover:-translate-y-0.5 hover:shadow-shadow',
      )}
    >
      {selected && (
        <span className="absolute -top-2.5 -right-2.5 grid size-7 place-items-center rounded-full border-2 border-border bg-due">
          <Check className="size-4" />
        </span>
      )}
      <span
        className={cn(
          'grid size-9 place-items-center rounded-base border-2 border-border',
          plant.kind === 'sprout' ? 'bg-due' : 'bg-chart-3 text-white',
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="w-full min-w-0">
        <span className="block font-heading leading-tight break-words hyphens-auto">{plant.name}</span>
        {plant.name_lat && <span className="block truncate text-xs italic">{plant.name_lat}</span>}
      </span>
      <span className="mt-auto flex flex-wrap gap-x-2 text-xs font-heading">
        {range && <span>{describeRange(range.min, range.max)}</span>}
        {plant.seed_g && <span>· {plant.seed_g} g</span>}
      </span>
    </button>
  )
}
