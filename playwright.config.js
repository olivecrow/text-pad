import { defineConfig } from '@playwright/test';

const browserTestPort = 4173;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  outputDir: 'output/playwright/test-results',
  use: {
    baseURL: `http://127.0.0.1:${browserTestPort}`,
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: {
      width: 900,
      height: 650
    }
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${browserTestPort}`,
    url: `http://127.0.0.1:${browserTestPort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
