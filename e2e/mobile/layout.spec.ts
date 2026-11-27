/**
 * Mobile layout matrix: phones, flip covers, book foldables (incl. the iPhone Duo folded and
 * unfolded) and tablets. Checks the shell picks the right navigation and pane mode, nothing
 * scrolls horizontally, every section opens, and touch targets in the navigation are ≥ 44px.
 */
import { expect, test } from '@playwright/test';

import { bootApp, type Harness, startHarness, unexpectedErrors } from './harness';

interface Device {
  name: string;
  width: number;
  height: number;
  nav: 'bar' | 'rail';
  panes: '1' | '2';
}

const DEVICES: Device[] = [
  { name: 'iPhone 17', width: 402, height: 874, nav: 'bar', panes: '1' },
  { name: 'Pixel 9', width: 412, height: 915, nav: 'bar', panes: '1' },
  { name: 'iPhone Duo folded', width: 466, height: 678, nav: 'bar', panes: '1' },
  { name: 'Galaxy Z Flip cover', width: 361, height: 399, nav: 'bar', panes: '1' },
  { name: 'iPhone Duo unfolded portrait', width: 669, height: 951, nav: 'bar', panes: '2' },
  { name: 'iPhone Duo unfolded landscape', width: 951, height: 669, nav: 'rail', panes: '2' },
  { name: 'Pixel 9 Pro Fold inner', width: 836, height: 842, nav: 'bar', panes: '2' },
  { name: 'Galaxy Z Fold inner', width: 744, height: 860, nav: 'bar', panes: '2' },
  { name: 'Pixel Tablet landscape', width: 1280, height: 800, nav: 'rail', panes: '2' },
  { name: 'iPad portrait', width: 820, height: 1180, nav: 'bar', panes: '2' },
];

let h: Harness;

test.beforeAll(async () => {
  h = await startHarness();
});

test.afterAll(async () => {
  await h.close();
});

for (const d of DEVICES) {
  test(`${d.name} (${d.width}×${d.height}) shell layout`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: d.width, height: d.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const boot = await bootApp(page, h);
    const root = page.locator('html');
    await expect(root).toHaveAttribute('data-mesh-mobile', 'web');
    await expect(root).toHaveAttribute('data-mobile-nav', d.nav);
    await expect(root).toHaveAttribute('data-mobile-panes', d.panes);
    await expect(page.locator('[data-app-shell]')).toBeVisible();

    // Navigation: bottom bar on narrow windows, rail on wide ones.
    const sections = [
      ['Chat', /^Chat/],
      ['Network', /^Network/],
      ['Map', /^Map/],
    ] as const;
    for (const [name, pattern] of sections) {
      const target = page.getByRole('button', { name: pattern }).first();
      await target.click();
      await expect(page.locator('main')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow on ${name}`).toBeLessThanOrEqual(1);
    }

    if (d.nav === 'bar') {
      const bar = page
        .locator('nav')
        .filter({ has: page.getByRole('button', { name: /^Chat/ }) })
        .last();
      const boxes = await bar.getByRole('button').evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { w: r.width, h: r.height };
        }),
      );
      for (const b of boxes) {
        expect(b.h).toBeGreaterThanOrEqual(44);
        expect(b.w).toBeGreaterThanOrEqual(44);
      }
    }

    // Desktop-only quit control is not offered in the mobile app.
    await expect(page.getByRole('button', { name: /disconnect & quit/i })).toHaveCount(0);

    await page.screenshot({ path: test.info().outputPath(`${d.name.replace(/\W+/g, '-')}.png`) });
    expect(unexpectedErrors(boot.pageErrors)).toEqual([]);
    await context.close();
  });
}
