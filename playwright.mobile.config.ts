/**
 * Playwright config for the mobile app's browser harness (`pnpm run test:mobile:web`).
 *
 * Serves the built mobile bundle (`dist-mobile/`, `pnpm run mobile:build`) with the MeshNet web
 * bridge standing in for the native socket/HTTP plugins, and runs the specs in `e2e/mobile/`
 * across phone, foldable (incl. iPhone Duo folded/unfolded) and tablet viewports.
 * Set MOBILE_E2E_CHROMIUM to use a system Chromium instead of Playwright's download.
 */
import { defineConfig } from '@playwright/test';

const executablePath = process.env.MOBILE_E2E_CHROMIUM || undefined;

export default defineConfig({
  testDir: './e2e/mobile',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results/mobile',
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
