/**
 * While the soft keyboard is up, the bottom bar steps aside so composers and search fields get the
 * height; it returns when the keyboard closes. The browser has no native keyboard, so the spec sets
 * the same state attribute the Capacitor Keyboard events set (mobile/src/viewport/mobileViewport.ts).
 */
import { expect, test } from '@playwright/test';

import { bootApp, type Harness, startHarness, unexpectedErrors } from './harness';

let h: Harness;

test.beforeAll(async () => {
  h = await startHarness();
});

test.afterAll(async () => {
  await h.close();
});

test('phone: the bottom bar steps aside while typing', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const boot = await bootApp(page, h);
  const more = page.locator('[data-nav-section="more"]');
  await expect(more).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.dataset.mobileKeyboard = 'open';
  });
  await expect(more).toBeHidden();
  // Content takes the freed height: main reaches the status strip, not a bar above it.
  const mainBottom = await page.evaluate(
    () => document.querySelector('main')?.getBoundingClientRect().bottom ?? 0,
  );
  expect(mainBottom).toBeGreaterThan(915 - 120);

  await page.evaluate(() => {
    delete document.documentElement.dataset.mobileKeyboard;
  });
  await expect(more).toBeVisible();
  expect(unexpectedErrors(boot.pageErrors)).toEqual([]);
  await context.close();
});
