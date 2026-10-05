import { expect, test } from '@playwright/test'

test('signed-out visitors get the sign-in screen', async ({ page }) => {
  await page.goto('/plants')
  await expect(page.getByRole('heading', { name: /Grow tiny greens/ })).toBeVisible()
  await expect(page.getByText('Sign in', { exact: true })).toHaveAttribute(
    'href',
    '/auth/login?return_to=%2Fplants',
  )
})

test('login errors from the server are explained', async ({ page }) => {
  await page.goto('/?auth_error=expired')
  await expect(page.getByText('The sign-in took too long. Try again.')).toBeVisible()
})
