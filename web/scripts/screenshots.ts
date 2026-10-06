// Retakes the README screenshots in docs/screenshots. Run it with `mise run screenshots`, with
// Postgres and Dex up.
//
// It creates a throwaway database, starts the production build against it on :3100, signs in as
// grower@example.com, and adds demo jars and batches at different stages. The dev database isn't
// touched, so test leftovers never show up in the pictures.

import { join } from 'node:path'
import { type Browser, type BrowserContextOptions, chromium, type Page } from '@playwright/test'
import { SQL } from 'bun'

const root = join(import.meta.dir, '..', '..')
const out = join(root, 'docs', 'screenshots')
const base = 'http://localhost:3100'
const database = 'baby_greens_screenshots'
const timezone = 'Europe/Budapest'

const HOUR = 60 * 60 * 1000
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString()

const devUrl = process.env.DATABASE_URL
if (!devUrl) throw new Error('DATABASE_URL is not set. Run this through `mise run screenshots`.')
const shotsUrl = new URL(devUrl)
shotsUrl.pathname = `/${database}`

async function recreateDatabase() {
  const admin = new SQL(devUrl!)
  await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`)
  await admin.unsafe(`CREATE DATABASE ${database}`)
  await admin.close()
}

async function dropDatabase() {
  const admin = new SQL(devUrl!)
  await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`)
  await admin.close()
}

function startServer() {
  return Bun.spawn([join(root, 'server/target/debug/baby-greens-server')], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: shotsUrl.toString(),
      BIND_ADDR: '127.0.0.1:3100',
      PUBLIC_URL: base,
      WEB_DIST: 'web/dist',
      VAPID_PRIVATE_KEY: '',
      RUST_LOG: 'warn',
    },
    stdout: 'inherit',
    stderr: 'inherit',
  })
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(500)
  }
  throw new Error('the server did not start on :3100')
}

/** Calls the API from the page, so the session cookie and Origin header come along. */
async function call<T = unknown>(page: Page, method: string, path: string, body?: unknown) {
  const result = await page.evaluate(
    async ([method, path, body]) => {
      const response = await fetch(`/api/v1${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: response.status, text: await response.text() }
    },
    [method, path, body] as const,
  )
  if (result.status >= 400) {
    throw new Error(`${method} ${path} failed with ${result.status}: ${result.text}`)
  }
  return (result.text ? JSON.parse(result.text) : undefined) as T
}

type Task = { id: string; kind: 'advance' | 'care'; due_at: string }
type Detail = { batch: { id: string; status: string }; open_tasks: Task[] }

/** Ticks the batch's advance tasks right when they came due, `steps` times. */
async function advance(page: Page, id: string, steps: number) {
  for (let step = 0; step < steps; step++) {
    const detail = await call<Detail>(page, 'GET', `/batches/${id}`)
    const task = detail.open_tasks.find((task) => task.kind === 'advance')!
    await call(page, 'POST', `/tasks/${task.id}/complete?done_at=${encodeURIComponent(task.due_at)}`)
  }
}

/** Ticks chores that came due more than `hours` ago, so only recent ones stay open. */
async function catchUp(page: Page, id: string, hours: number) {
  for (;;) {
    const detail = await call<Detail>(page, 'GET', `/batches/${id}`)
    const stale = detail.open_tasks.find(
      (task) => task.kind === 'care' && new Date(task.due_at).getTime() < Date.now() - hours * HOUR,
    )
    if (!stale) return
    await call(page, 'POST', `/tasks/${stale.id}/complete?done_at=${encodeURIComponent(stale.due_at)}`)
  }
}

async function seed(page: Page) {
  await call(page, 'PATCH', '/me', { timezone })

  // Mung beans get a supplier link, so the batch page shows one.
  const mung = await call<{ plant: Record<string, unknown> }>(page, 'GET', '/plants/mung-bean')
  await call(page, 'PUT', '/plants/mung-bean', {
    ...mung.plant,
    links: [
      { label: 'Seed supplier', url: 'https://example.com/mung-beans' },
      { label: 'Sprouting guide', url: 'https://example.com/sprouting' },
    ],
  })

  const jar = async (name: string, kind: 'jar' | 'tray', color?: string) =>
    (await call<{ id: string }>(page, 'POST', '/containers', { name, kind, color })).id
  const jar1 = await jar('Jar 1', 'jar', '#22c55e')
  const jar2 = await jar('Jar 2', 'jar', '#3b82f6')
  const jar3 = await jar('Jar 3', 'jar')
  const trayA = await jar('Tray A', 'tray', '#f97316')
  const trayB = await jar('Tray B', 'tray', '#a855f7')
  await jar('Tray C', 'tray')

  const start = async (plant_slug: string, container_id: string, hoursAgo: number) =>
    (
      await call<Detail>(page, 'POST', '/batches', {
        plant_slug,
        container_id,
        started_at: ago(hoursAgo),
      })
    ).batch.id

  // Finished batches, for the harvest log and the results.
  const radish = await start('radish-microgreens', trayA, 6.5 * 24)
  await advance(page, radish, 2)
  await call(page, 'POST', `/batches/${radish}/harvests`, {
    harvested_at: ago(10),
    yield_g: 118,
    rating: 5,
    notes: 'Spicy and even.',
  })
  const broccoli = await start('broccoli-sprouts', jar3, 5 * 24)
  await advance(page, broccoli, 2)
  await call(page, 'POST', `/batches/${broccoli}/harvests`, {
    harvested_at: ago(36),
    yield_g: 165,
    rating: 4,
  })

  // Growing now, at different stages.
  const peas = await start('pea-shoots', trayB, 6 * 24)
  await advance(page, peas, 2)
  await catchUp(page, peas, 8)
  const sunflower = await start('sunflower', trayA, 3 * 24)
  await advance(page, sunflower, 1)
  await catchUp(page, sunflower, 8)
  const mungBatch = await start('mung-bean', jar1, 38)
  await advance(page, mungBatch, 1)
  await catchUp(page, mungBatch, 8)
  // Just soaked long enough, so draining it is due.
  await start('alfalfa', jar2, 9)

  return { mungBatch }
}

async function signIn(page: Page) {
  await page.goto(base)
  await page.getByText('Sign in', { exact: true }).click()
  await page.fill('#login', 'grower@example.com')
  await page.fill('#password', 'password')
  await page.click('#submit-login')
  await page.getByRole('heading', { name: /Good (morning|afternoon|evening)|Up late/ }).waitFor()
}

async function shoot(page: Page, path: string, name: string) {
  await page.goto(`${base}${path}`)
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: join(out, `${name}.png`) })
  console.log(`docs/screenshots/${name}.png`)
}

async function withContext(
  browser: Browser,
  options: BrowserContextOptions,
  storageState: Awaited<ReturnType<Page['context']>['storageState']>,
  run: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({ ...options, storageState, timezoneId: timezone })
  await run(await context.newPage())
  await context.close()
}

const phone: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
}
const desktop: BrowserContextOptions = { viewport: { width: 1280, height: 800 } }

await recreateDatabase()
const server = startServer()
try {
  await waitForServer()
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ timezoneId: timezone })
    await signIn(page)
    const { mungBatch } = await seed(page)
    const state = await page.context().storageState()

    await withContext(browser, { ...phone, colorScheme: 'light' }, state, async (page) => {
      await shoot(page, '/', 'today')
      await shoot(page, `/batches/${mungBatch}`, 'batch')
      await shoot(page, '/plants', 'plants')
    })
    await withContext(browser, { ...desktop, colorScheme: 'dark' }, state, async (page) => {
      await shoot(page, '/', 'desktop-dark')
    })
  } finally {
    await browser.close()
  }
} finally {
  server.kill()
  await server.exited
  await dropDatabase()
}
