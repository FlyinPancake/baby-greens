import { expect, type Page, test } from '@playwright/test'
import { deleteTestPlant, saveTestPlant, testJar } from './fixtures'

const plantPicker = (page: Page) => page.getByRole('radiogroup', { name: 'Plant' })

test('start a batch, advance it, and discard it', async ({ page }, testInfo) => {
  const jar = await testJar(page, testInfo.project.name)
  const plant = await saveTestPlant(page, testInfo.project.name)
  page.on('dialog', (dialog) => dialog.accept())

  await page.goto('/batches/new')
  await plantPicker(page).getByRole('radio', { name: plant.name }).click()
  await page.getByRole('radio', { name: jar, exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Seed in grams' })).toHaveValue('60')
  await page.getByRole('button', { name: /Start/ }).last().click()

  // The new batch page, soaking, with the drain task waiting.
  await expect(page.getByRole('heading', { name: plant.name })).toBeVisible()
  await expect(page.getByText('You are here')).toBeVisible()
  await page.getByRole('button', { name: 'Mark "Drain the soak water" done' }).click()

  // Draining moves it into sprouting, with a rinse and the harvest scheduled.
  await expect(page.getByText('Sprouting').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark "Rinse and drain" done' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark "Harvest" done' })).toBeVisible()

  // Snoozing the rinse pushes it back and says so.
  await page.getByRole('button', { name: 'Snooze "Rinse and drain"' }).click()
  await page.getByRole('group', { name: 'Snooze for' }).getByRole('button', { name: '3 hours' }).click()
  await expect(page.getByText(/^snoozed until /)).toBeVisible()

  // The container page shows the jar as busy.
  await page.getByRole('link', { name: jar, exact: true }).click()
  await expect(page.getByRole('heading', { name: jar })).toBeVisible()
  await expect(page.getByText('growing', { exact: true })).toBeVisible()
  await page.goBack()

  await page.getByRole('button', { name: 'Discard batch' }).click()
  await expect(page.getByText('discarded')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Discard batch' })).toHaveCount(0)

  // Discarding frees the jar. It has history, so it gets archived rather than deleted.
  await page.goto('/containers')
  const card = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: jar, exact: true }) })
  await expect(card.getByText('Free')).toBeVisible()
  await card.getByRole('button', { name: 'Archive' }).click()
  await expect(card.getByRole('button', { name: 'Archive' })).toHaveCount(0)
  await deleteTestPlant(page, plant)
})

test('a busy jar is shown but cannot be picked', async ({ page }) => {
  await page.goto('/batches/new')
  await plantPicker(page).getByRole('radio', { name: /Lentil sprouts/ }).click()
  const containers: { name: string; occupant: unknown; archived_at: string | null }[] =
    await page.evaluate(() => fetch('/api/v1/containers').then((response) => response.json()))
  // Skip the test jars, which other tests fill and empty while this one runs.
  const busy = containers.find(
    (container) =>
      container.occupant && !container.archived_at && !container.name.startsWith('e2e'),
  )
  test.skip(!busy, 'nothing is growing right now')
  await expect(page.getByRole('radio', { name: new RegExp(`^${busy!.name}`) })).toBeDisabled()
})

test('a jar added from the batch form gets picked', async ({ page }, testInfo) => {
  const name = `e2e new jar ${testInfo.project.name} ${Date.now()}`

  await page.goto('/batches/new')
  await plantPicker(page).getByRole('radio', { name: /Alfalfa sprouts/ }).click()
  await page.getByRole('textbox', { name: 'Name a new jar' }).fill(name)
  await page.getByRole('button', { name: 'Add jar' }).click()
  await expect(page.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText(`${name} · 15 g`)).toBeVisible()

  // It never held a batch, so delete it again.
  await page.goto('/containers')
  await page.getByRole('listitem').filter({ hasText: name }).getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText(name)).toHaveCount(0)
})
