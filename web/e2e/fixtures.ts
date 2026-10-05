import type { Page } from '@playwright/test'

// The tests share the dev database with whoever is using the app, and anyone can customize the
// built-in plants. So tests that care about a plant's steps use their own, with known steps,
// and delete it afterwards. Batches keep a copy of their plant, so deleting it is safe.

export const testPlantName = 'E2E test sprouts'

/** Soak 8h to 12h, sprout 2d to 5d with a rinse every 12h, then harvest. 60 g of seed. */
const definition = {
  name: testPlantName,
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

/** Saves this project's test plant and returns its slug. The page must be on the app. */
export async function saveTestPlant(page: Page, project: string): Promise<string> {
  const slug = `e2e-sprouts-${project}`
  const status = await page.evaluate(
    ([slug, body]) =>
      fetch(`/api/v1/plants/${slug}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then((response) => response.status),
    [slug, definition] as const,
  )
  if (status !== 200) throw new Error(`saving the test plant failed with ${status}`)
  return slug
}

export async function deleteTestPlant(page: Page, slug: string): Promise<void> {
  await page.evaluate((slug) => fetch(`/api/v1/plants/${slug}`, { method: 'DELETE' }), slug)
}
