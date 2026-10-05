import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { ContainerCard } from '@/components/ContainerCard'
import { ColorPicker } from '@/components/ContainerColor'
import { EmptyState } from '@/components/EmptyState'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Highlight, PageHeading } from '@/components/PageHeading'
import { Segmented } from '@/components/Segmented'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, type ContainerKind, containersQuery, unwrap } from '@/lib/api'
import { containerKindOptions, Jar } from '@/lib/icons'

export const Route = createFileRoute('/containers/')({
  component: Containers,
})

function Containers() {
  const containers = useQuery(containersQuery)
  const current = containers.data?.filter((container) => !container.archived_at) ?? []
  const archived = containers.data?.filter((container) => container.archived_at) ?? []
  const free = current.filter((container) => !container.occupant).length

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeading>
        Jars &amp; <Highlight>trays</Highlight>
      </PageHeading>
      <p>
        Shared by everyone on this server.{' '}
        {containers.data && (
          <span className="font-heading">
            {free} of {current.length} free.
          </span>
        )}
      </p>

      <AddContainer />

      <ErrorAlert error={containers.error} />
      {containers.isPending ? (
        <p className="font-heading">Loading...</p>
      ) : current.length === 0 ? (
        <EmptyState icon={Jar} title="No jars or trays yet">
          Add the jars and trays you grow in, then pick them when you start a batch.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {current.map((container) => (
            <ContainerCard key={container.id} container={container} />
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer font-heading">Archived ({archived.length})</summary>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {archived.map((container) => (
              <ContainerCard key={container.id} container={container} />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function AddContainer() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ContainerKind>('jar')
  const [color, setColor] = useState<string | null>(null)

  const add = useMutation({
    mutationFn: () => unwrap(api.POST('/containers', { body: { name, kind, color } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['containers'] })
      setName('')
      setColor(null)
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (name.trim()) add.mutate()
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-base border-2 border-dashed border-border p-4"
    >
      <p className="font-heading">Add a jar or tray</p>
      <div className="flex flex-wrap gap-2">
        <Segmented label="Kind" value={kind} onChange={setKind} options={containerKindOptions} />
        <div className="flex min-w-0 flex-1 basis-56 gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={kind === 'jar' ? 'jar 5' : 'tray E'}
            aria-label="Name"
            maxLength={60}
            className="min-w-0"
          />
          <Button type="submit" disabled={!name.trim() || add.isPending}>
            <Plus /> Add
          </Button>
        </div>
      </div>
      <ColorPicker value={color} onChange={setColor} />
      <ErrorAlert error={add.error} />
    </form>
  )
}
