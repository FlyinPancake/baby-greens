import { defineConfig, devices } from '@playwright/test'

// End-to-end tests against the dev stack. Start Postgres and Dex with `mise run up` first. The
// API and Vite dev servers start on their own, or get reused if `mise run dev` is running.

const signedIn = { storageState: 'e2e/.auth/user.json' }

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'signed-out',
      testMatch: /signin\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'desktop',
      testIgnore: /signin\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], ...signedIn },
    },
    {
      name: 'phone',
      testIgnore: /signin\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 667 },
        isMobile: true,
        hasTouch: true,
        ...signedIn,
      },
    },
    {
      name: 'small-phone',
      testMatch: /layout\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 320, height: 640 },
        isMobile: true,
        hasTouch: true,
        ...signedIn,
      },
    },
  ],
  webServer: {
    command: 'mise run dev',
    cwd: '..',
    url: 'http://localhost:5173/api/health',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
