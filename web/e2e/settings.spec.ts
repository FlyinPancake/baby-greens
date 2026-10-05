import { expect, test } from '@playwright/test'

test('timezone and quiet hours are saved', async ({ page }, testInfo) => {
  // Every project signs in as the same user, so only one may change their settings.
  test.skip(testInfo.project.name !== 'desktop', 'changes shared account settings')
  await page.goto('/settings')
  const timezone = page.getByRole('combobox', { name: 'Timezone' })
  await expect(timezone).toBeVisible()
  const original = await timezone.inputValue()
  const target = original === 'Asia/Tokyo' ? 'Europe/Budapest' : 'Asia/Tokyo'

  await timezone.selectOption(target)
  await page.getByRole('radio', { name: 'On' }).click()
  await page.getByRole('textbox', { name: 'Quiet hours start' }).fill('21:30')
  await page.getByRole('textbox', { name: 'Quiet hours end' }).fill('06:45')
  await page.getByRole('button', { name: 'Save schedule' }).click()
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Timezone' })).toHaveValue(target)
  await expect(page.getByRole('textbox', { name: 'Quiet hours start' })).toHaveValue('21:30')
  await expect(page.getByRole('textbox', { name: 'Quiet hours end' })).toHaveValue('06:45')

  // Put things back for the next run.
  await page.getByRole('combobox', { name: 'Timezone' }).selectOption(original)
  await page.getByRole('radio', { name: 'Off' }).click()
  await page.getByRole('button', { name: 'Save schedule' }).click()
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
})

test('the reminders panel settles on a status', async ({ page }) => {
  await page.goto('/settings')
  // Headless Chromium has no push service, so it may end on an error. It must not hang.
  await expect(page.getByText('Checking this device...')).toHaveCount(0, { timeout: 15_000 })
})
