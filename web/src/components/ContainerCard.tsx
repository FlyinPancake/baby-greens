import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Archive, ArchiveRestore, Pencil, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { api, type Container, type ContainerKind, unwrap } from '@/lib/api'
import { containerIcons, containerKindOptions } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { ErrorAlert } from './ErrorAlert'
import { Segmented } from './Segmented'

/** A jar or tray, with what's growing in it and buttons to edit, archive, or delete it. */
export function ContainerCard({ container }: { container: Container }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const Icon = containerIcons[container.kind]
  const archived = container.archived_at != null

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['containers'] })

  const update = useMutation({
    mutationFn: (body: {
      name?: string
      kind?: ContainerKind
      notes?: string
      archived?: boolean
    }) =>
      unwrap(api.PATCH('/containers/{id}', { params: { path: { id: container.id } }, body })),
    onSuccess: async () => {
      await refresh()
      setEditing(false)
    },
  })

  const remove = useMutation({
    mutationFn: () =>
      unwrap(api.DELETE('/containers/{id}', { params: { path: { id: container.id } } })),
    onSuccess: refresh,
  })

  if (editing) {
    return (
      <EditContainer
        container={container}
        pending={update.isPending}
        error={update.error}
        onSave={(changes) => update.mutate(changes)}
        onCancel={() => {
          update.reset()
          setEditing(false)
        }}
      />
    )
  }

  return (
    <li
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-base border-2 border-border bg-secondary-background p-4',
        archived ? 'border-dashed opacity-70' : 'shadow-shadow',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-base border-2 border-border',
            container.occupant ? 'bg-main' : 'bg-background',
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <Link
            to="/containers/$id"
            params={{ id: container.id }}
            className="block truncate font-heading text-lg hover:underline"
          >
            {container.name}
          </Link>
          <p className="text-sm">
            {container.kind} · {container.batch_count}{' '}
            {container.batch_count === 1 ? 'batch' : 'batches'}
          </p>
        </div>
      </div>

      <Status container={container} />
      {container.notes && <p className="text-sm whitespace-pre-wrap">{container.notes}</p>}
      <ErrorAlert error={update.error ?? remove.error} />

      <div className="mt-auto flex flex-wrap gap-2">
        {!archived && (
          <Button variant="neutral" size="sm" onClick={() => setEditing(true)}>
            <Pencil /> Edit
          </Button>
        )}
        {archived ? (
          <Button
            variant="neutral"
            size="sm"
            disabled={update.isPending}
            onClick={() => update.mutate({ archived: false })}
          >
            <ArchiveRestore /> Restore
          </Button>
        ) : container.batch_count > 0 ? (
          <Button
            variant="neutral"
            size="sm"
            disabled={update.isPending || container.occupant != null}
            title={container.occupant ? 'Something is growing in it' : undefined}
            onClick={() => update.mutate({ archived: true })}
          >
            <Archive /> Archive
          </Button>
        ) : (
          <Button
            variant="neutral"
            size="sm"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            <Trash2 /> Delete
          </Button>
        )}
      </div>
    </li>
  )
}

function Status({ container }: { container: Container }) {
  const { occupant } = container
  if (container.archived_at) {
    return <p className="text-sm font-heading">Archived</p>
  }
  if (!occupant) {
    return (
      <p className="w-fit rounded-base border-2 border-border bg-background px-2 py-0.5 text-sm font-heading">
        Free
      </p>
    )
  }
  return (
    <p className="w-fit max-w-full truncate rounded-base border-2 border-border bg-main px-2 py-0.5 text-sm font-heading">
      Growing{' '}
      {occupant.batch_id ? (
        <Link to="/batches/$id" params={{ id: occupant.batch_id }} className="underline">
          {occupant.plant_name}
        </Link>
      ) : (
        <>
          {occupant.plant_name} for {occupant.grower}
        </>
      )}
    </p>
  )
}

function EditContainer({
  container,
  pending,
  error,
  onSave,
  onCancel,
}: {
  container: Container
  pending: boolean
  error: Error | null
  onSave: (changes: { name: string; kind: ContainerKind; notes: string }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(container.name)
  const [kind, setKind] = useState<ContainerKind>(container.kind)
  const [notes, setNotes] = useState(container.notes)

  function submit(event: FormEvent) {
    event.preventDefault()
    onSave({ name, kind, notes })
  }

  return (
    <li className="min-w-0 rounded-base border-2 border-border bg-secondary-background p-4 shadow-shadow">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="Name"
          maxLength={60}
          autoFocus
        />
        <Segmented label="Kind" value={kind} onChange={setKind} options={containerKindOptions} />
        <Textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          aria-label="Notes"
          placeholder="Notes, like its size or where it lives"
          rows={2}
        />
        <ErrorAlert error={error} />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={pending || !name.trim()}>
            Save
          </Button>
          <Button type="button" variant="neutral" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </li>
  )
}
