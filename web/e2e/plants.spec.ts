import { expect, test } from '@playwright/test'
import { deleteTestPlant, saveTestPlant } from './fixtures'

test('the editor shows server validation next to the field', async ({ page }, testInfo) => {
  await page.goto('/plants')
  const slug = await saveTestPlant(page, testInfo.project.name)
  await page.goto(`/plants/${slug}`)
  // Step 2 (sprout) runs 2 to 5 days. A 1 day maximum is shorter than its minimum.
  const sprout = page.getByRole('listitem').filter({ hasText: 'Chores during this step' }).nth(1)
  await sprout.getByRole('textbox').nth(1).fill('1d')
  await page.getByRole('button', { name: 'Save changes' }).first().click()

  await expect(sprout.getByText('must not be shorter than duration_min')).toBeVisible()
  await deleteTestPlant(page, slug)
})

test('durations that are not durations are flagged while typing', async ({ page }) => {
  await page.goto('/plants/pea-shoots')
  const firstStep = page.getByRole('listitem').filter({ hasText: 'Chores during this step' }).first()
  await firstStep.getByRole('textbox').first().fill('eight hours')
  await expect(firstStep.getByText('Use a number and a unit')).toBeVisible()
  await firstStep.getByRole('textbox').first().fill('1d 12h')
  await expect(firstStep.getByText('1 day 12 hours')).toBeVisible()
})

test('create a custom plant, then delete it', async ({ page }, testInfo) => {
  const slug = `e2e-${testInfo.project.name}-${Date.now()}`

  await page.goto('/plants')
  await page.getByRole('textbox', { name: 'Slug for the new plant' }).fill(slug)
  await page.getByRole('button', { name: 'Create' }).click()

  await expect(page.getByText('This slug is free')).toBeVisible()
  await page.getByRole('textbox').first().fill('Test cress')
  await page.getByRole('button', { name: 'Save changes' }).first().click()

  await expect(page.getByText('A custom plant, shared by everyone on this server.')).toBeVisible()
  await page.goto('/plants')
  const card = page.getByRole('listitem').filter({ hasText: 'Test cress' })
  await expect(card.getByText('custom', { exact: true })).toBeVisible()

  await card.getByRole('link').click()
  await page.getByRole('button', { name: 'Delete plant' }).click()
  await expect(page).toHaveURL(/\/plants$/)
  await expect(page.getByText('Test cress')).toHaveCount(0)
})
