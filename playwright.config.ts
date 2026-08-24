import { defineConfig, devices } from '@playwright/test'

const port = 4173

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    channel: process.env.CI ? undefined : 'chrome',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: `npm run build:pwa && npm exec vite -- preview --host 127.0.0.1 --port ${port} --base /kakeflow/app/`,
    url: `http://127.0.0.1:${port}/kakeflow/app/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
