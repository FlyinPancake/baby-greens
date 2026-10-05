import { expect, test } from '@playwright/test'

test('add, rename, and delete a container', async ({ page }, testInfo) => {
  const name = `e2e tray ${testInfo.project.name} ${Date.now()}`
  const renamed = `${name} renamed`

  await page.goto('/containers')
  const form = page.locator('form').filter({ hasText: 'Add a jar or tray' })
  await form.getByRole('radio', { name: 'Tray' }).click()
  await form.getByRole('textbox', { name: 'Name' }).fill(name)
  await form.getByRole('button', { name: 'Add' }).click()

  const card = page.getByRole('listitem').filter({ hasText: name })
  await expect(card.getByText('Free')).toBeVisible()
  await expect(card.getByText('tray · 0 batches')).toBeVisible()

  // Names are unique ignoring case, and the error lands on the form.
  await form.getByRole('textbox', { name: 'Name' }).fill(name.toUpperCase())
  await form.getByRole('button', { name: 'Add' }).click()
  await expect(form.getByText('another jar or tray already has this name')).toBeVisible()

  await card.getByRole('button', { name: 'Edit' }).click()
  const editor = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Cancel' }) })
  await editor.getByRole('textbox', { name: 'Name' }).fill(renamed)
  await editor.getByRole('button', { name: 'Save' }).click()

  const renamedCard = page.getByRole('listitem').filter({ hasText: renamed })
  await expect(renamedCard).toBeVisible()

  // It never held a batch, so it can be deleted outright.
  await renamedCard.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText(renamed)).toHaveCount(0)
})
