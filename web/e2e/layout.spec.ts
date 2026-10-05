import { expect, type Page, test } from '@playwright/test'

/** How far the page scrolls sideways. Zero means it fits the screen. */
async function sidewaysScroll(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement
    return root.scrollWidth - root.clientWidth
  })
}

/** Elements whose box crosses a screen edge, to explain a failure. Clipped ones count too. */
async function wideElements(page: Page): Promise<string> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth
    return [...document.querySelectorAll('body *')]
      .filter((element) => {
        const box = element.getBoundingClientRect()
        return box.width > 0 && (box.right > width + 1 || box.left < -1)
      })
      .slice(0, 5)
      .map((element) => `<${element.tagName.toLowerCase()}> "${element.textContent?.slice(0, 30)}"`)
      .join(', ')
  })
}

async function expectFits(page: Page) {
  const scroll = await sidewaysScroll(page)
  expect(scroll, scroll > 0 ? `scrolls sideways; wide: ${await wideElements(page)}` : '').toBe(0)
}

const pages = [
  { path: '/', ready: 'Growing' },
  { path: '/plants', ready: 'Add your own plant' },
  { path: '/plants/pea-shoots', ready: 'Basics' },
  { path: '/plants/e2e-new-plant', ready: 'This slug is free' },
  { path: '/batches/new', ready: 'Pick a plant' },
  { path: '/containers', ready: 'Add a jar or tray' },
  { path: '/settings', ready: 'Reminder schedule' },
]

for (const { path, ready } of pages) {
  test(`${path} fits the screen without sideways scrolling`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByText(ready).first()).toBeVisible()
    await expectFits(page)
  })
}

test('the batch form fits the screen with a plant picked', async ({ page }) => {
  await page.goto('/batches/new')
  await page.getByRole('radiogroup', { name: 'Plant' }).getByRole('radio', { name: /Sunflower microgreens/ }).click()
  await expect(page.getByText('Grow ticket')).toBeVisible()
  await expectFits(page)
})

test('a container page fits the screen', async ({ page }) => {
  await page.goto('/containers')
  await expect(page.getByText('Add a jar or tray')).toBeVisible()
  const containers = await page.evaluate(() => fetch('/api/v1/containers').then((r) => r.json()))
  test.skip(containers.length === 0, 'no containers to open')
  await page.goto(`/containers/${containers[0].id}`)
  await expect(page.getByText('Your batches in it')).toBeVisible()
  await expectFits(page)
})
