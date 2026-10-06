import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Sprout } from 'lucide-react'
import { BatchCard } from '@/components/BatchCard'
import { ContainerTile } from '@/components/ContainerColor'
import { EmptyState } from '@/components/EmptyState'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { batchesQuery, type Container, containerQuery } from '@/lib/api'
import { containerIcons } from '@/lib/icons'

export const Route = createFileRoute('/containers/$id')({
  component: ContainerPage,
})

function ContainerPage() {
  const { id } = Route.useParams()
  const container = useQuery(containerQuery(id))

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link to="/containers" className="flex w-fit items-center gap-1 font-heading hover:underline">
        <ArrowLeft className="size-4" /> Jars &amp; trays
      </Link>
      {container.isPending ? (
        <p className="font-heading">Loading...</p>
      ) : container.isError ? (
        <ErrorAlert error={container.error} />
      ) : (
        <ContainerHistory container={container.data} />
      )}
    </div>
  )
}

function ContainerHistory({ container }: { container: Container }) {
  const batches = useQuery(batchesQuery({ containerId: container.id }))
  const Icon = containerIcons[container.kind]
  const free = !container.occupant && !container.archived_at

  return (
    <>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <ContainerTile
            container={container}
            className="size-12 -rotate-6 shadow-shadow"
            iconClassName="size-6"
          />
          <h1 className="text-4xl tracking-tight">{container.name}</h1>
          <Badge className="rotate-3 bg-due font-heading shadow-shadow">
            {container.archived_at ? 'archived' : container.occupant ? 'growing' : 'free'}
          </Badge>
        </div>
        {container.notes && <p className="whitespace-pre-wrap">{container.notes}</p>}
        <p>
          {container.batch_count} {container.batch_count === 1 ? 'batch' : 'batches'} in the
          household so far.
        </p>
        {free && (
          <div>
            <Button
              nativeButton={false}
              render={<Link to="/batches/new" search={{ container: container.id }} />}
            >
              <Sprout /> Start a batch here
            </Button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl">Your batches in it</h2>
        <ErrorAlert error={batches.error} />
        {batches.isPending ? (
          <p className="font-heading">Loading...</p>
        ) : batches.data?.length === 0 ? (
          <EmptyState icon={Icon} title="Nothing yet">
            Batches you grow in {container.name} show up here.
          </EmptyState>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {batches.data?.map((batch) => (
              <BatchCard key={batch.id} batch={batch} />
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
