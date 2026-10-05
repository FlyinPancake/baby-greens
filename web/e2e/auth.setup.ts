import { expect, test as setup } from '@playwright/test'

// Tests run as Dex's second user, so they never touch the data of `grower@example.com`.
setup('sign in through Dex', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Sign in', { exact: true }).click()
  await page.fill('#login', 'second@example.com')
  await page.fill('#password', 'password')
  await page.click('#submit-login')
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)|Up late/ })).toBeVisible()
  await page.context().storageState({ path: 'e2e/.auth/user.json' })
})
