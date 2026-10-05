import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, type Container, type ContainerKind, unwrap } from '@/lib/api'
import { containerIcons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { ErrorAlert } from './ErrorAlert'

/**
 * Chips for the household's jars and trays. Ones holding a batch can't be picked. Containers of
 * `preferredKind` come first, and new ones get that kind.
 */
export function ContainerPicker({
  containers,
  value,
  onChange,
  preferredKind,
}: {
  containers: Container[]
  value: string | null
  onChange: (id: string) => void
  preferredKind: ContainerKind
}) {
  const shown = containers
    .filter((container) => !container.archived_at)
    .sort(
      (a, b) =>
        Number(b.kind === preferredKind) - Number(a.kind === preferredKind) ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    )

  return (
    <div className="flex flex-col gap-3">
      {shown.length > 0 && (
        <div role="radiogroup" aria-label="Jar or tray" className="flex flex-wrap gap-2">
          {shown.map((container) => {
            const Icon = containerIcons[container.kind]
            const busy = container.occupant != null
            const selected = container.id === value
            return (
              <button
                key={container.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={busy}
                onClick={() => onChange(container.id)}
                title={busy ? `Growing ${container.occupant?.plant_name}` : undefined}
                className={cn(
                  'flex h-9 items-center gap-1.5 rounded-base border-2 border-border px-3 text-sm font-heading transition-all',
                  selected && 'bg-main shadow-shadow',
                  !selected && !busy && 'bg-background hover:-translate-y-0.5',
                  busy && 'cursor-not-allowed border-dashed bg-secondary-background opacity-60',
                )}
              >
                <Icon className="size-4" />
                {container.name}
                {busy && (
                  <span className="max-w-24 truncate rounded-sm bg-due px-1 text-[10px] uppercase">
                    {container.occupant?.plant_name}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
      <AddContainer kind={preferredKind} onAdded={onChange} />
    </div>
  )
}

function AddContainer({ kind, onAdded }: { kind: ContainerKind; onAdded: (id: string) => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')

  const add = useMutation({
    mutationFn: () => unwrap(api.POST('/containers', { body: { name, kind } })),
    onSuccess: async (container) => {
      await queryClient.invalidateQueries({ queryKey: ['containers'] })
      setName('')
      onAdded(container.id)
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (name.trim()) add.mutate()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={kind === 'jar' ? 'new jar, like "jar 5"' : 'new tray, like "tray E"'}
          aria-label={`Name a new ${kind}`}
          maxLength={60}
          className="h-9"
        />
        <Button type="submit" variant="neutral" size="sm" disabled={!name.trim() || add.isPending}>
          <Plus /> Add {kind}
        </Button>
      </div>
      <ErrorAlert error={add.error} />
    </form>
  )
}
