import type { Page } from '@playwright/test'

// The tests share the dev database with whoever is using the app, and anyone can customize the
// built-in plants. So tests that care about a plant's steps use their own, with known steps,
// and delete it afterwards. Batches keep a copy of their plant, so deleting it is safe.

/** Soak 8h to 12h, sprout 2d to 5d with a rinse every 12h, then harvest. 60 g of seed. */
const definition = {
  kind: 'sprout',
  seed_g: 60,
  steps: [
    { action: 'soak', duration_min: '8h', duration_max: '12h' },
    {
      action: 'sprout',
      duration_min: '2d',
      duration_max: '5d',
      care: [{ action: 'rinse', every: '12h' }],
    },
    { action: 'harvest' },
  ],
}

let saved = 0

export type TestPlant = { slug: string; name: string }

/**
 * Saves a test plant. Each call gets its own slug and name, so tests running in parallel never
 * pick or delete each other's plant. The page must be on the app.
 */
export async function saveTestPlant(page: Page, project: string): Promise<TestPlant> {
  saved += 1
  const id = `${project}-${Date.now()}-${saved}`
  const slug = `e2e-sprouts-${id}`
  const name = `E2E sprouts ${id}`
  const status = await page.evaluate(
    ([slug, body]) =>
      fetch(`/api/v1/plants/${slug}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then((response) => response.status),
    [slug, { ...definition, name }] as const,
  )
  if (status !== 200) throw new Error(`saving the test plant failed with ${status}`)
  return { slug, name }
}

export async function deleteTestPlant(page: Page, { slug }: TestPlant): Promise<void> {
  await page.evaluate((slug) => fetch(`/api/v1/plants/${slug}`, { method: 'DELETE' }), slug)
}

/** Deletes test plants that earlier runs left behind, for example when a test failed. */
export async function sweepTestPlants(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const entries: { slug: string; source: string }[] = await fetch('/api/v1/plants').then(
      (response) => response.json(),
    )
    for (const entry of entries) {
      if (entry.slug.startsWith('e2e-') && entry.source === 'custom') {
        await fetch(`/api/v1/plants/${entry.slug}`, { method: 'DELETE' })
      }
    }
  })
}

/**
 * Makes sure this project's test jar exists and isn't archived, and returns its name. Reusing one
 * jar per project keeps test runs from piling up containers in the shared household list.
 */
export async function testJar(page: Page, project: string): Promise<string> {
  const name = `e2e jar ${project}`
  await page.goto('/containers')
  await page.evaluate(async (name) => {
    type Container = {
      id: string
      name: string
      archived_at: string | null
      occupant: { batch_id: string | null } | null
    }
    const containers: Container[] = await fetch('/api/v1/containers').then((response) =>
      response.json(),
    )
    const existing = containers.find((container) => container.name === name)
    const headers = { 'content-type': 'application/json' }
    // A run that died halfway can leave its batch growing in the jar.
    if (existing?.occupant?.batch_id) {
      await fetch(`/api/v1/batches/${existing.occupant.batch_id}/discard`, { method: 'POST' })
    }
    if (!existing) {
      await fetch('/api/v1/containers', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, kind: 'jar' }),
      })
    } else if (existing.archived_at) {
      await fetch(`/api/v1/containers/${existing.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ archived: false }),
      })
    }
  }, name)
  return name
}

/** Starts a batch through the API and returns its id. The page must be on the app. */
export async function startBatch(
  page: Page,
  plantSlug: string,
  jarName: string,
  hoursAgo: number,
): Promise<string> {
  return page.evaluate(
    async ({ plantSlug, jarName, hoursAgo }) => {
      const containers: { id: string; name: string }[] = await fetch('/api/v1/containers').then(
        (response) => response.json(),
      )
      const jar = containers.find((container) => container.name === jarName)
      const started = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString()
      const response = await fetch('/api/v1/batches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plant_slug: plantSlug, container_id: jar?.id, started_at: started }),
      })
      if (!response.ok) throw new Error(`starting a batch failed with ${response.status}`)
      return (await response.json()).batch.id as string
    },
    { plantSlug, jarName, hoursAgo },
  )
}

/** Discards a batch if it's still active, and archives its jar, so the next run starts clean. */
export async function cleanUp(page: Page, batchId: string, jarName: string): Promise<void> {
  await page.evaluate(
    async ({ batchId, jarName }) => {
      await fetch(`/api/v1/batches/${batchId}/discard`, { method: 'POST' })
      const containers: { id: string; name: string }[] = await fetch('/api/v1/containers').then(
        (response) => response.json(),
      )
      const jar = containers.find((container) => container.name === jarName)
      if (jar) {
        await fetch(`/api/v1/containers/${jar.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ archived: true }),
        })
      }
    },
    { batchId, jarName },
  )
}
