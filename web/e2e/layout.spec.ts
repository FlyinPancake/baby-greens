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

/**
 * Visible text-entry fields smaller than 16px. iOS Safari zooms the page in when one of those gets
 * focus, and stays zoomed.
 */
async function smallFields(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const notTyped = ['checkbox', 'radio', 'color', 'range', 'hidden', 'button', 'submit', 'file']
    return [...document.querySelectorAll<HTMLElement>('input, select, textarea')]
      .filter((field) => !(field instanceof HTMLInputElement && notTyped.includes(field.type)))
      .filter((field) => field.checkVisibility())
      .filter((field) => parseFloat(getComputedStyle(field).fontSize) < 16)
      .map((field) => {
        const name = field.getAttribute('aria-label') ?? field.getAttribute('placeholder') ?? ''
        return `<${field.tagName.toLowerCase()}> "${name}" ${getComputedStyle(field).fontSize}`
      })
  })
}

async function expectNoZoom(page: Page) {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, 'only phones zoom into small fields')
  expect(await smallFields(page)).toEqual([])
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

for (const { path, ready } of pages) {
  test(`${path} has no fields small enough to zoom into`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByText(ready).first()).toBeVisible()
    await expectNoZoom(page)
  })
}

test('the JSON editor is big enough not to zoom into', async ({ page }) => {
  await page.goto('/plants/pea-shoots')
  await page.getByRole('radio', { name: 'JSON' }).click()
  await expect(page.getByText('pea-shoots.json')).toBeVisible()
  await expectNoZoom(page)
})

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
  await expect(page.getByText('Batches in it', { exact: true })).toBeVisible()
  await expectFits(page)
})
