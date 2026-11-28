/**
 * Playwright config for the mobile app's browser harness (`pnpm -C mobile run test:e2e`).
 *
 * Serves the built mobile bundle (`mobile/dist/`, `pnpm -C mobile run build`) with the MeshNet web
 * bridge standing in for the native socket/HTTP plugins, and runs the specs in `e2e/`
 * across phone, foldable (incl. iPhone Duo folded/unfolded) and tablet viewports.
 * Set MOBILE_E2E_CHROMIUM to use a system Chromium instead of Playwright's download.
 */
import { defineConfig } from '@playwright/test';

const executablePath = process.env.MOBILE_E2E_CHROMIUM || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  use: {
    browserName: 'chromium',
    launchOptions: executablePath ? { executablePath } : {},
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
