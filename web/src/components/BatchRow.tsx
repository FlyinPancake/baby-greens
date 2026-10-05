import { Link } from '@tanstack/react-router'
import type { BatchSummary } from '../lib/api'
import { stepLabels } from '../lib/labels'
import { formatWindow } from '../lib/time'

export function BatchRow({ batch }: { batch: BatchSummary }) {
  return (
    <li>
      <Link
        to="/batches/$id"
        params={{ id: batch.id }}
        className="flex items-center justify-between gap-3 py-3 hover:bg-stone-50"
      >
        <div className="min-w-0">
          <p className="font-medium">{batch.plant_name}</p>
          <p className="text-sm text-stone-500">
            {batch.container} · {stepLabels[batch.current_action]}
          </p>
        </div>
        {batch.harvest_window && (
          <p className="shrink-0 text-right text-sm text-stone-600">
            Harvest
            <br />
            {formatWindow(batch.harvest_window.earliest, batch.harvest_window.latest)}
          </p>
        )}
      </Link>
    </li>
  )
}
