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
