import { defineConfig, devices } from '@playwright/test'

// End-to-end tests against a production build on :3100, served by the Rust server like in
// production. Start Postgres and Dex with `mise run up` first. The Vite dev server isn't
// involved, so hot reloads from editing files can't interrupt a test run.

const signedIn = { storageState: 'e2e/.auth/user.json' }

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry everywhere. Chromium aborts requests with ERR_NETWORK_CHANGED whenever the OS
  // reports a network change (Wi-Fi, Docker bridges, Tailscale), which has nothing to do with
  // the app. Tests that only pass on retry show up as "flaky" in the summary.
  retries: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3100',
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
  // E2E_EXTERNAL_SERVER=1 tests a server that's already on :3100 instead, like the container image.
  webServer: process.env.E2E_EXTERNAL_SERVER ? undefined : {
    command: 'mise run test:e2e:server',
    cwd: '..',
    url: 'http://localhost:3100/api/health',
    // Always a fresh build, so a leftover server can't test stale code.
    reuseExistingServer: false,
    timeout: 300_000,
  },
})
