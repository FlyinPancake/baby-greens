import { Link } from '@tanstack/react-router'
import { ColorDot } from '@/components/ContainerColor'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import type { BatchSummary } from '@/lib/api'
import { stepLabels } from '@/lib/labels'
import { formatWhen, formatWindow, percentBetween } from '@/lib/time'
import { useOtherGrower } from '@/lib/useGrower'
import { useNow } from '@/lib/useNow'
import { stepIcons } from '@/lib/icons'

export function BatchCard({ batch }: { batch: BatchSummary }) {
  const now = useNow()
  const grower = useOtherGrower(batch)
  const Icon = stepIcons[batch.current_action]
  const progress = batch.harvest_window
    ? percentBetween(batch.started_at, batch.harvest_window.earliest, now)
    : 100

  return (
    <li className="min-w-0">
      <Link
        to="/batches/$id"
        params={{ id: batch.id }}
        className="flex h-full flex-col gap-3 rounded-base border-2 border-border bg-secondary-background p-4 shadow-shadow transition-all hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-heading text-lg">{batch.plant_name}</p>
            <p className="flex items-center gap-1.5 text-sm">
              {batch.container_color && <ColorDot color={batch.container_color} />}
              {batch.container}
              {grower && <> · {grower}'s</>}
            </p>
          </div>
          <Badge className={batch.plant_kind === 'sprout' ? 'bg-due' : 'bg-chart-3 text-white'}>
            {batch.plant_kind === 'sprout' ? 'sprout' : 'microgreen'}
          </Badge>
        </div>
        {batch.status === 'active' ? (
          <>
            <p className="flex items-center gap-2 text-sm font-heading">
              <Icon className="size-4" />
              {stepLabels[batch.current_action]}
            </p>
            <Progress value={progress} aria-label="Progress to the earliest harvest" />
          </>
        ) : (
          <p className="text-sm">
            <span className="font-heading capitalize">{batch.status}</span>, started{' '}
            {formatWhen(batch.started_at, now)}
          </p>
        )}
        {batch.harvest_window && (
          <p className="text-sm">
            Harvest <span className="font-heading">{formatWindow(batch.harvest_window.earliest, batch.harvest_window.latest, now)}</span>
          </p>
        )}
      </Link>
    </li>
  )
}
