import { expect, test } from '@playwright/test'
import { cleanUp, deleteTestPlant, saveTestPlant, startBatch, testJar } from './fixtures'

test('harvesting leads to the harvest log, which feeds the plant results', async ({
  page,
}, testInfo) => {
  const project = `${testInfo.project.name}-harvest`
  const jar = await testJar(page, project)
  const plant = await saveTestPlant(page, project)
  page.on('dialog', (dialog) => dialog.accept())
  // Soaked 9 hours ago, so draining is due.
  const batchId = await startBatch(page, plant.slug, jar, 9)

  await page.goto(`/batches/${batchId}`)
  await page.getByRole('button', { name: 'Mark "Drain the soak water" done' }).click()
  await page.getByRole('button', { name: 'Mark "Harvest" done' }).click()

  // Harvesting lands on the harvest form, ready for the yield.
  await expect(page).toHaveURL(/#harvest-log$/)
  const yieldInput = page.getByRole('spinbutton', { name: 'Yield in grams' })
  await expect(yieldInput).toBeFocused()
  await yieldInput.fill('120')
  await page.getByRole('radio', { name: '4 stars' }).click()
  await page.getByRole('textbox', { name: 'Notes' }).fill('Crunchy')
  await page.getByRole('button', { name: 'Log harvest' }).click()

  // 120 g from 60 g of seed is 2.0 times the seed.
  const log = page.locator('#harvest-log')
  await expect(log.getByText('120 g').first()).toBeVisible()
  await expect(log.getByText('2.0×')).toBeVisible()
  await expect(log.getByLabel('4 of 5 stars')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Log another cut' })).toBeVisible()

  await page.goto(`/plants/${plant.slug}`)
  await expect(page.getByText('Results', { exact: true })).toBeVisible()
  await expect(page.getByText('2.0×')).toBeVisible()

  await cleanUp(page, batchId, jar)
  await deleteTestPlant(page, plant)
})
