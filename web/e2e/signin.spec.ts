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

test('signing out shows the sign-in screen right away', async ({ page }) => {
  // Its own session, so signing out doesn't end the one the other tests share.
  await page.goto('/')
  await page.getByText('Sign in', { exact: true }).click()
  await page.fill('#login', 'second@example.com')
  await page.fill('#password', 'password')
  await page.click('#submit-login')
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Sign out' }).click()

  await expect(page.getByRole('heading', { name: /Grow tiny greens/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: /Grow tiny greens/ })).toBeVisible()
})
