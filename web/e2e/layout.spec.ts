import { expect, type Page, test } from '@playwright/test'

/** Elements that stick out past the right or left edge of the viewport. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth
    return [...document.querySelectorAll('body *')]
      .filter((element) => {
        const box = element.getBoundingClientRect()
        return box.width > 0 && (box.right > width + 1 || box.left < -1)
      })
      .slice(0, 5)
      .map((element) => `<${element.tagName.toLowerCase()}> "${element.textContent?.slice(0, 30)}"`)
  })
}

const pages = [
  { path: '/', ready: 'Growing' },
  { path: '/plants', ready: 'Add your own plant' },
  { path: '/plants/pea-shoots', ready: 'Basics' },
  { path: '/plants/e2e-new-plant', ready: 'This slug is free' },
  { path: '/batches/new', ready: 'Pick a plant' },
]

for (const { path, ready } of pages) {
  test(`${path} fits the screen without sideways scrolling`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByText(ready).first()).toBeVisible()
    expect(await overflowing(page)).toEqual([])
  })
}

test('the batch form fits the screen with a plant picked', async ({ page }) => {
  await page.goto('/batches/new')
  await page.getByRole('radio', { name: /Sunflower microgreens/ }).click()
  await expect(page.getByText('Grow ticket')).toBeVisible()
  expect(await overflowing(page)).toEqual([])
})
