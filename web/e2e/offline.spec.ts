import { expect, test } from '@playwright/test'
import { cleanUp, deleteTestPlant, saveTestPlant, startBatch, testJar } from './fixtures'

test('ticks made offline wait, survive a reload, and sync when back online', async ({
  page,
  context,
}, testInfo) => {
  const project = `${testInfo.project.name}-offline`
  const jar = await testJar(page, project)
  const plant = await saveTestPlant(page, project)
  const batchId = await startBatch(page, plant.slug, jar, 9)

  await page.goto('/')
  // The task card, not the batch card under Growing, which also names the plant.
  const taskCard = () =>
    page.getByRole('listitem').filter({ hasText: 'Drain the soak water' }).filter({ hasText: plant.name })
  const card = taskCard()
  await expect(card.getByText('Drain the soak water')).toBeVisible()
  // The service worker has to control the page to serve it offline, and the cache needs a
  // moment to be written to IndexedDB.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  await page.waitForTimeout(1500)

  await context.setOffline(true)
  await expect(page.getByText("You're offline.")).toBeVisible()
  await card.getByRole('button', { name: 'Mark "Drain the soak water" done' }).click()
  await expect(card).toHaveCount(0)
  await expect(page.getByText('1 change will sync when you\'re back.')).toBeVisible()

  // Reloading offline brings the app back from the service worker and the saved cache.
  await page.reload()
  await expect(page.getByRole('heading', { name: /Good|Up late/ })).toBeVisible()
  await expect(page.getByText('1 change will sync when you\'re back.')).toBeVisible()
  await expect(taskCard()).toHaveCount(0)

  await context.setOffline(false)
  await expect(page.getByText(/change will sync|Syncing/)).toHaveCount(0)
  const detail = await page.evaluate(
    (id) => fetch(`/api/v1/batches/${id}`).then((response) => response.json()),
    batchId,
  )
  expect(detail.batch.current_action).toBe('sprout')

  await cleanUp(page, batchId, jar)
  await deleteTestPlant(page, plant)
})

test('an expired session holds offline ticks until you sign in again', async ({
  page,
  context,
}, testInfo) => {
  const project = `${testInfo.project.name}-relogin`
  const jar = await testJar(page, project)
  const plant = await saveTestPlant(page, project)
  const batchId = await startBatch(page, plant.slug, jar, 9)

  await page.goto('/')
  const taskCard = page
    .getByRole('listitem')
    .filter({ hasText: 'Drain the soak water' })
    .filter({ hasText: plant.name })
  await expect(taskCard).toBeVisible()

  await context.setOffline(true)
  await taskCard.getByRole('button', { name: 'Mark "Drain the soak water" done' }).click()
  await expect(page.getByText("1 change will sync when you're back.")).toBeVisible()

  // The session runs out while offline.
  await context.clearCookies()
  await context.setOffline(false)
  const banner = page.getByRole('status').filter({ hasText: 'Sign in again to sync 1 change' })
  await expect(banner).toBeVisible()

  await banner.getByText('Sign in', { exact: true }).click()
  await page.fill('#login', 'second@example.com')
  await page.fill('#password', 'password')
  await page.click('#submit-login')

  // Back in the app, the waiting tick goes out.
  await expect(page.getByRole('heading', { name: /Good|Up late/ })).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0)
  const detail = await page.evaluate(
    (id) => fetch(`/api/v1/batches/${id}`).then((response) => response.json()),
    batchId,
  )
  expect(detail.batch.current_action).toBe('sprout')

  await cleanUp(page, batchId, jar)
  await deleteTestPlant(page, plant)
})
