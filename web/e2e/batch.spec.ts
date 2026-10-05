import { expect, test } from '@playwright/test'

test('start a batch, advance it, and discard it', async ({ page }, testInfo) => {
  // A unique container name finds this test's batch among anything else on the account.
  const container = `e2e ${testInfo.project.name} ${Date.now()}`
  page.on('dialog', (dialog) => dialog.accept())

  await page.goto('/batches/new')
  await page.getByRole('radio', { name: /Mung bean sprouts/ }).click()
  await page.getByRole('textbox', { name: 'Jar or tray' }).fill(container)
  await expect(page.getByRole('spinbutton', { name: 'Seed in grams' })).toHaveValue('60')
  await page.getByRole('button', { name: /Start/ }).last().click()

  // The new batch page, soaking, with the drain task waiting.
  await expect(page.getByRole('heading', { name: 'Mung bean sprouts' })).toBeVisible()
  await expect(page.getByText('You are here')).toBeVisible()
  await expect(page.getByText(container)).toBeVisible()
  await page.getByRole('button', { name: 'Mark "Drain the soak water" done' }).click()

  // Draining moves it into sprouting, with a rinse and the harvest scheduled.
  await expect(page.getByText('Sprouting').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark "Rinse and drain" done' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark "Harvest" done' })).toBeVisible()

  await page.getByRole('button', { name: 'Discard batch' }).click()
  await expect(page.getByText('discarded')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Discard batch' })).toHaveCount(0)
})
