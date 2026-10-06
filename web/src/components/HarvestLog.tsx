import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Minus, Plus, Scissors, Trash2 } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { api, type BatchDetail, unwrap } from '@/lib/api'
import { perform } from '@/lib/outbox'
import { formatWhen, toLocalInput } from '@/lib/time'
import { useOutbox } from '@/lib/useOutbox'
import { ErrorAlert } from './ErrorAlert'
import { StarRating } from './StarRating'

/** What a harvested batch yielded, and a form to log a cut. */
export function HarvestLog({ detail }: { detail: BatchDetail }) {
  const { batch, harvests } = detail
  const { entries } = useOutbox()
  const waiting = entries.filter((entry) => entry.kind === 'harvest' && entry.batchId === batch.id)
  const [adding, setAdding] = useState(false)
  const showForm = adding || (harvests.length === 0 && waiting.length === 0)

  const total = harvests.reduce((sum, harvest) => sum + harvest.yield_g, 0)
  const ratio = batch.seed_g > 0 ? total / batch.seed_g : 0

  return (
    <section id="harvest-log" className="flex scroll-mt-24 flex-col gap-3">
      <h2 className="text-2xl">Harvest log</h2>

      {harvests.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Harvested" value={`${total} g`} />
          <Stat label="Per gram of seed" value={`${ratio.toFixed(1)}×`} />
        </div>
      )}

      {(harvests.length > 0 || waiting.length > 0) && (
        <ul className="flex flex-col gap-3">
          {harvests.map((harvest) => (
            <HarvestRow key={harvest.id} harvest={harvest} />
          ))}
          {waiting.map((entry) =>
            entry.kind === 'harvest' ? (
              <li
                key={entry.id}
                className="flex items-center gap-3 rounded-base border-2 border-dashed border-border bg-secondary-background p-3"
              >
                <Scissors className="size-5 shrink-0" />
                <p className="flex-1 font-heading">{entry.body.yield_g} g</p>
                <span className="text-sm">waiting to sync</span>
              </li>
            ) : null,
          )}
        </ul>
      )}

      {showForm ? (
        <HarvestForm
          batchId={batch.id}
          plantName={batch.plant_name}
          onDone={() => setAdding(false)}
          canCancel={harvests.length > 0 || waiting.length > 0}
        />
      ) : (
        <div>
          <Button variant="neutral" onClick={() => setAdding(true)}>
            <Plus /> Log another cut
          </Button>
        </div>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-base border-2 border-border bg-main p-3 shadow-shadow">
      <p className="text-xs font-heading tracking-wide uppercase">{label}</p>
      <p className="mt-1 font-heading text-2xl">{value}</p>
    </div>
  )
}

function HarvestRow({ harvest }: { harvest: BatchDetail['harvests'][number] }) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () =>
      unwrap(api.DELETE('/harvests/{id}', { params: { path: { id: harvest.id } } })),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['batches'] }),
        queryClient.invalidateQueries({ queryKey: ['stats'] }),
      ]),
  })

  return (
    <li className="flex flex-col gap-2 rounded-base border-2 border-border bg-secondary-background p-3 shadow-shadow">
      <div className="flex flex-wrap items-center gap-3">
        <Scissors className="size-5 shrink-0" />
        <p className="font-heading">{harvest.yield_g} g</p>
        <StarRating value={harvest.rating ?? null} size="size-4" />
        <p className="flex-1 text-right text-sm">{formatWhen(harvest.harvested_at)}</p>
        <Button
          variant="neutral"
          size="icon-sm"
          aria-label={`Delete the ${harvest.yield_g} g harvest`}
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm('Delete this harvest?')) remove.mutate()
          }}
        >
          <Trash2 />
        </Button>
      </div>
      {harvest.notes && <p className="text-sm whitespace-pre-wrap">{harvest.notes}</p>}
      <ErrorAlert error={remove.error} />
    </li>
  )
}

function HarvestForm({
  batchId,
  plantName,
  onDone,
  canCancel,
}: {
  batchId: string
  plantName: string
  onDone: () => void
  canCancel: boolean
}) {
  const queryClient = useQueryClient()
  const [yieldG, setYieldG] = useState('')
  const [rating, setRating] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [harvestedAt, setHarvestedAt] = useState(() => toLocalInput(new Date()))
  const [latest] = useState(harvestedAt)
  const yieldInput = useRef<HTMLInputElement>(null)

  // Arriving from a finished Harvest task, start typing the yield right away.
  useEffect(() => {
    if (window.location.hash === '#harvest-log') yieldInput.current?.focus()
  }, [])

  const save = useMutation({
    mutationFn: () =>
      perform({
        kind: 'harvest',
        batchId,
        label: `The ${plantName} harvest`,
        body: {
          yield_g: Number(yieldG),
          rating,
          notes,
          harvested_at: new Date(harvestedAt).toISOString(),
        },
      }),
    onSuccess: () => {
      setYieldG('')
      setRating(null)
      setNotes('')
      onDone()
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['batches'] }),
        queryClient.invalidateQueries({ queryKey: ['stats'] }),
      ]),
  })

  const grams = Number(yieldG)
  const valid = yieldG !== '' && Number.isInteger(grams) && grams >= 0

  function submit(event: FormEvent) {
    event.preventDefault()
    if (valid) save.mutate()
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-base border-2 border-border bg-secondary-background p-4 shadow-shadow"
    >
      <p className="font-heading">How did it go?</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="neutral"
          size="icon"
          aria-label="Less"
          onClick={() => setYieldG(String(Math.max(0, (grams || 0) - 10)))}
        >
          <Minus />
        </Button>
        <div className="flex h-10 items-center gap-1 rounded-base border-2 border-border bg-background px-3">
          <input
            ref={yieldInput}
            type="number"
            min={0}
            inputMode="numeric"
            value={yieldG}
            onChange={(event) => setYieldG(event.target.value)}
            aria-label="Yield in grams"
            placeholder="0"
            className="w-16 bg-transparent text-right font-heading text-lg outline-none"
          />
          <span className="font-heading">g</span>
        </div>
        <Button
          type="button"
          variant="neutral"
          size="icon"
          aria-label="More"
          onClick={() => setYieldG(String((grams || 0) + 10))}
        >
          <Plus />
        </Button>
      </div>

      <StarRating value={rating} onChange={setRating} />

      <Textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        rows={2}
        aria-label="Notes"
        placeholder="Crunchy, a bit bitter, harvest a day earlier next time..."
      />

      <label className="flex flex-wrap items-center gap-2 text-sm font-heading">
        Harvested
        <input
          type="datetime-local"
          value={harvestedAt}
          max={latest}
          onChange={(event) => setHarvestedAt(event.target.value)}
          className="h-9 rounded-base border-2 border-border bg-background px-2 text-base md:text-sm"
        />
      </label>

      <ErrorAlert error={save.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={!valid || save.isPending}>
          <Scissors /> Log harvest
        </Button>
        {canCancel && (
          <Button type="button" variant="neutral" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
