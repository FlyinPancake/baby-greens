import { useQuery } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import { type PlantStats, plantStatsQuery } from '@/lib/api'

/** Your stats for one plant, from the shared stats query. */
function usePlantStats(slug: string): PlantStats | undefined {
  const stats = useQuery(plantStatsQuery)
  return stats.data?.find((entry) => entry.plant_slug === slug)
}

/** A one-line summary, like "10× · ★ 4.0 · 3 harvests". */
export function PlantResultsLine({ slug }: { slug: string }) {
  const stats = usePlantStats(slug)
  if (!stats) return null
  return (
    <p className="flex items-center gap-1.5 text-xs font-heading">
      <span className="rounded-sm bg-main px-1">{stats.yield_ratio.toFixed(1)}×</span>
      {stats.average_rating != null && (
        <>
          <Star className="size-3.5 fill-due" aria-hidden />
          {stats.average_rating.toFixed(1)}
        </>
      )}
      <span>
        · {stats.batches} {stats.batches === 1 ? 'harvest' : 'harvests'}
      </span>
    </p>
  )
}

/** The full results panel for a plant's page. */
export function PlantResults({ slug }: { slug: string }) {
  const stats = usePlantStats(slug)
  return (
    <div className="flex flex-col gap-3 rounded-base border-2 border-border bg-secondary-background p-4 shadow-shadow">
      <p className="text-xs font-heading tracking-widest uppercase">Your results</p>
      {stats ? (
        <dl className="grid grid-cols-2 gap-3">
          <Fact label="Per gram of seed" value={`${stats.yield_ratio.toFixed(1)}×`} />
          <Fact label="Harvested" value={`${stats.yield_g} g`} />
          <Fact
            label="Rating"
            value={stats.average_rating != null ? `${stats.average_rating.toFixed(1)} / 5` : 'none'}
          />
          <Fact label="Days to harvest" value={stats.average_days.toFixed(1)} />
        </dl>
      ) : (
        <p className="text-sm">Log a harvest of this plant to see how it does for you.</p>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-heading tracking-wide uppercase">{label}</dt>
      <dd className="font-heading text-lg">{value}</dd>
    </div>
  )
}
