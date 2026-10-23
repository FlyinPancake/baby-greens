import { expect, test } from '@playwright/test'
import { cleanUp, deleteTestPlant, saveTestPlant, startBatch, testJar } from './fixtures'

test('the calendar shows a growing batch and opens it', async ({ page }, testInfo) => {
  const project = `${testInfo.project.name}-calendar`
  const jar = await testJar(page, project)
  const plant = await saveTestPlant(page, project)
  const batchId = await startBatch(page, plant.slug, jar, 2)

  await page.goto('/calendar')
  await expect(page.getByText('Planned steps assume')).toBeVisible()
  // A batch that runs into next week has a bar in each week, so take the first.
  await page.getByRole('link', { name: `${plant.name} in ${jar}` }).first().click()
  await expect(page.getByRole('heading', { name: plant.name })).toBeVisible()

  // The month buttons move between months and back to this one.
  await page.goto('/calendar')
  const month = await page.getByRole('heading', { level: 2 }).textContent()
  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page.getByRole('heading', { level: 2 })).not.toHaveText(month!)
  await page.getByRole('button', { name: 'Today' }).click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(month!)

  // A month that doesn't exist shows this one instead of rolling over into next year.
  await page.goto('/calendar?month=2026-13')
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(month!)

  await cleanUp(page, batchId, jar)
  await deleteTestPlant(page, plant)
})
