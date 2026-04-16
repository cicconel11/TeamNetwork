import { defineConfig, devices } from '@playwright/test';

/**
 * Lightpanda Cloud endpoint for headless browser testing.
 * 16x less memory, 9x faster than Chrome.
 * @see https://lightpanda.io/docs/
 */
const LIGHTPANDA_TOKEN = process.env.LIGHTPANDA_TOKEN;
const LIGHTPANDA_ENDPOINT = LIGHTPANDA_TOKEN
  ? `wss://euwest.cloud.lightpanda.io/ws?token=${LIGHTPANDA_TOKEN}`
  : undefined;

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html'],
    ['json', { outputFile: 'audit/playwright-results.json' }],
    ['list']
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.AUDIT_BASE_URL || 'https://www.myteamnetwork.com',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Take screenshot on failure */
    screenshot: 'only-on-failure',

    /* Record video on failure */
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'audit-crawler',
      testDir: './tests/audit',
      testMatch: 'crawl.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        /* Use saved auth state */
        storageState: process.env.AUDIT_STORAGE_STATE || 'playwright/.auth/state.json',
      },
    },
    /* E2E Auth Setup - runs first to create authenticated state */
    {
      name: 'e2e-setup',
      testDir: './tests/e2e',
      testMatch: /auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3000',
      },
    },
    /* E2E Tests - depends on auth setup */
    {
      name: 'e2e',
      testDir: './tests/e2e/specs',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3000',
        storageState: 'playwright/.auth/e2e-state.json',
      },
      dependencies: ['e2e-setup'],
    },
    /* Lightpanda Cloud - fast headless browser for CI */
    {
      name: 'lightpanda',
      testDir: './tests/e2e/specs',
      use: {
        baseURL: 'http://localhost:3000',
        storageState: 'playwright/.auth/e2e-state.json',
        // Connect to Lightpanda Cloud via CDP
        connectOptions: LIGHTPANDA_ENDPOINT
          ? { wsEndpoint: LIGHTPANDA_ENDPOINT }
          : undefined,
      },
      dependencies: ['e2e-setup'],
    },
    /* FERPA Compliance Tests - requires auth */
    {
      name: 'ferpa',
      testDir: './tests/e2e/specs',
      testMatch: 'ferpa-compliance.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3000',
        storageState: 'playwright/.auth/e2e-state.json',
      },
      dependencies: ['e2e-setup'],
    },
    /* FERPA API Tests - no auth required */
    {
      name: 'ferpa-api',
      testDir: './tests/e2e/specs',
      testMatch: 'ferpa-api.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3000',
      },
    },
  ],

  /* Folder for test artifacts such as screenshots, videos, traces, etc. */
  outputDir: 'audit/playwright-artifacts/',

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});






