/**
 * iPhone Duo system side column: with the outer display's 84 pt column emulated (real
 * env(safe-area-inset-right) through CDP) and the camera / Dynamic Island rectangle the native
 * plugin reports, the bottom bar stands in that column, tabs at the bottom and clear of the camera,
 * content keeps the rest of the width, and typing hides the column navigation. Negative cases: the
 * same inset without an occlusion rectangle, and a notched iPhone in landscape, keep the bar.
 */
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';

import { bootApp, type Harness, startHarness, unexpectedErrors } from './harness';

interface Geometry {
  width: number;
  height: number;
  insets: { top: number; right: number; bottom: number; left: number };
  occlusions: { left: number; top: number; right: number; bottom: number }[];
}

const DUO_FOLDED: Geometry = {
  width: 466,
  height: 678,
  insets: { top: 0, right: 84, bottom: 21, left: 0 },
  occlusions: [{ left: 396, top: 10, right: 456, bottom: 120 }],
};

let h: Harness;

test.beforeAll(async () => {
  h = await startHarness();
});

test.afterAll(async () => {
  await h.close();
});

async function open(
  browser: Browser,
  g: Geometry,
): Promise<{ context: BrowserContext; page: Page; pageErrors: string[] }> {
  const context = await browser.newContext({
    viewport: { width: g.width, height: g.height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: g.insets });
  await page.addInitScript((occlusions) => {
    localStorage.setItem(
      'mesh-mobile:web-device-geometry',
      JSON.stringify({ folds: [], occlusions }),
    );
  }, g.occlusions);
  const boot = await bootApp(page, h);
  await expect(page.locator('[data-app-shell]')).toBeVisible();
  return { context, page, pageErrors: boot.pageErrors };
}

function navButtons(page: Page) {
  return page
    .locator('nav')
    .filter({ has: page.getByRole('button', { name: /^Chat/ }) })
    .last()
    .getByRole('button');
}

test('folded iPhone Duo: navigation stands in the system side column', async ({ browser }) => {
  const { context, page, pageErrors } = await open(browser, DUO_FOLDED);
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-mobile-side-column', 'right');
  await expect(root).toHaveAttribute('data-mobile-nav', 'bar');

  const boxes = await navButtons(page).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        w: r.width,
        h: r.height,
      };
    }),
  );
  expect(boxes.length).toBeGreaterThanOrEqual(4); // Chat, Network, Map (+ Incident), More
  for (const b of boxes) {
    // Inside the column, below the camera / Dynamic Island, above the home indicator.
    expect(b.left).toBeGreaterThanOrEqual(DUO_FOLDED.width - 84 - 1);
    expect(b.right).toBeLessThanOrEqual(DUO_FOLDED.width + 1);
    expect(b.top).toBeGreaterThanOrEqual(120);
    expect(b.bottom).toBeLessThanOrEqual(DUO_FOLDED.height - 21 + 1);
    expect(b.h).toBeGreaterThanOrEqual(44);
    expect(b.w).toBeGreaterThanOrEqual(44);
  }
  // Tabs sit at the bottom of the column (Apple: tab bars at the bottom of the side column).
  const lowest = Math.max(...boxes.map((b) => b.bottom));
  expect(lowest).toBeGreaterThan(DUO_FOLDED.height - 21 - 24);

  // Content keeps the width left of the column and nothing scrolls sideways.
  const main = await page.locator('main').boundingBox();
  expect(main?.x ?? 0).toBeGreaterThanOrEqual(0);
  expect((main?.x ?? 0) + (main?.width ?? 0)).toBeLessThanOrEqual(DUO_FOLDED.width - 84 + 1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);

  // Every section still opens from the column.
  for (const name of [/^Network/, /^Map/, /^Chat/]) {
    await page.getByRole('button', { name }).first().click();
    await expect(page.locator('main')).toBeVisible();
  }

  await page.screenshot({ path: test.info().outputPath('duo-folded-side-column.png') });
  expect(unexpectedErrors(pageErrors)).toEqual([]);
  await context.close();
});

test('folded iPhone Duo: the column navigation steps aside while typing', async ({ browser }) => {
  const { context, page } = await open(browser, DUO_FOLDED);
  await expect(page.locator('html')).toHaveAttribute('data-mobile-side-column', 'right');
  const nav = page.locator('[data-mobile-side-nav]');
  await expect(nav).toBeVisible();
  // The Capacitor Keyboard plugin's native resize is not available in a browser; the shell keys
  // the column off the same state attribute the keyboard events set.
  await page.evaluate(() => {
    document.documentElement.dataset.mobileKeyboard = 'open';
  });
  await expect(nav).toBeHidden();
  await page.evaluate(() => {
    delete document.documentElement.dataset.mobileKeyboard;
  });
  await expect(nav).toBeVisible();
  await context.close();
});

test('same inset without a native camera rectangle keeps the bottom bar', async ({ browser }) => {
  const { context, page } = await open(browser, { ...DUO_FOLDED, occlusions: [] });
  await expect(page.locator('html')).not.toHaveAttribute('data-mobile-side-column', /.+/);
  await expect(page.locator('[data-mobile-side-nav]')).toHaveCount(0);
  await expect(navButtons(page).first()).toBeVisible();
  await context.close();
});

test('notched iPhone in landscape keeps the bottom bar', async ({ browser }) => {
  const { context, page } = await open(browser, {
    width: 874,
    height: 402,
    insets: { top: 0, right: 62, bottom: 21, left: 62 },
    occlusions: [{ left: 0, top: 150, right: 37, bottom: 250 }],
  });
  await expect(page.locator('html')).not.toHaveAttribute('data-mobile-side-column', /.+/);
  await expect(page.locator('[data-mobile-side-nav]')).toHaveCount(0);
  await context.close();
});
