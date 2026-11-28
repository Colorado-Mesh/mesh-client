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
    // Nor the app update indicator: the stores update the app, and the inert mobile updater left
    // it on "Checking..." in the status strip.
    const strip = page.locator('footer').last();
    await expect(strip).toBeVisible();
    await expect(strip).not.toContainText(/checking/i);

    await page.screenshot({ path: test.info().outputPath(`${d.name.replace(/\W+/g, '-')}.png`) });
    expect(unexpectedErrors(boot.pageErrors)).toEqual([]);
    await context.close();
  });
}

// App > Saved locations rows wrap rather than squeeze the coordinates: on a 375 px phone the
// active row showed one character of them (the name field, Doesn't move, Active and the delete
// button took the line). mobileShell.css gives the coordinates a minimum width. The longest pair
// the app writes is decimal with both signs and a three-digit longitude ("-33.86880, -151.20930";
// MGRS is one shorter token); the last case shows it at the largest text size (fontScale 1.5).
const SAVED_LOCATION_CASES = [
  { width: 361, fontScale: 1 },
  { width: 375, fontScale: 1 },
  { width: 412, fontScale: 1 },
  { width: 361, fontScale: 1.5 },
];
for (const { width, fontScale } of SAVED_LOCATION_CASES) {
  test(`saved location rows show their full coordinates at ${width} px, text ${fontScale}x`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width, height: 812 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.addInitScript((scale) => {
      localStorage.setItem('mesh-client:fontScale', String(scale));
      localStorage.setItem(
        'mesh-client:gpsSettings',
        JSON.stringify({ staticLat: 39.75, staticLon: -105.0 }),
      );
      localStorage.setItem(
        'mesh-client:savedLocations',
        JSON.stringify({
          locations: [
            { id: 'loc-e2e-phone', name: 'This phone', lat: 39.75, lon: -105.0, fixed: false },
            { id: 'loc-e2e-far', name: 'Sydney EOC', lat: -33.8688, lon: -151.2093, fixed: true },
          ],
          activeId: 'loc-e2e-phone',
        }),
      );
    }, fontScale);
    const boot = await bootApp(page, h);
    await page.locator('[data-nav-section="more"]').click();
    await page.getByRole('dialog').getByRole('button', { name: /^App/ }).first().click();
    const anchor = page.locator('[data-setting-anchor="app.gps.savedLocations"]');
    await anchor.evaluate((el) => {
      const details = el.closest('details');
      if (details) details.open = true;
    });
    // The text size setting scales the root font (fontScale.ts applyFontScale).
    await expect(page.locator('html')).toHaveCSS('font-size', `${String(16 * fontScale)}px`);
    const coords = anchor.locator('li > input[type="text"] + span');
    await expect(coords).toHaveCount(2);
    await expect(coords.nth(1)).toHaveText('-33.86880, -151.20930');
    const rows = await coords.evaluateAll((els) =>
      els.map((e) => ({
        text: e.textContent ?? '',
        clipped: e.scrollWidth > e.clientWidth + 1,
        width: Math.round(e.getBoundingClientRect().width),
      })),
    );
    for (const row of rows) {
      expect(row.text.length, 'coordinates rendered').toBeGreaterThan(5);
      expect(row.clipped, `coordinates cut off: ${JSON.stringify(row)}`).toBe(false);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await anchor.screenshot({
      path: test.info().outputPath(`saved-locations-${String(width)}-${String(fontScale)}x.png`),
    });
    expect(unexpectedErrors(boot.pageErrors)).toEqual([]);
    await context.close();
  });
}

// The launch location card at the largest text size on a 361 px cover screen: its title row holds
// the icon and close button so the text spans the card, and button labels wrap inside the card
// (at 1.5x, "Use this phone's location" ran past the card's edge).
test('location card fits a 361 px screen at the largest text size', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 361, height: 812 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('mesh-client:fontScale', '1.5');
    localStorage.setItem(
      'mesh-client:gpsSettings',
      JSON.stringify({ staticLat: 39.75, staticLon: -105.0 }),
    );
    localStorage.setItem(
      'mesh-client:savedLocations',
      JSON.stringify({
        locations: [
          { id: 'loc-e2e-phone', name: 'This phone', lat: 39.75, lon: -105.0, fixed: false },
          { id: 'loc-e2e-far', name: 'Sydney EOC', lat: -33.8688, lon: -151.2093, fixed: true },
        ],
        activeId: 'loc-e2e-phone',
      }),
    );
  });
  const boot = await bootApp(page, h);
  const card = page.locator('[data-mobile-location-prompt] section');
  await expect(card.getByRole('heading', { name: 'Still at This phone?' })).toBeVisible();
  const layout = await card.evaluate((section) => {
    const box = section.getBoundingClientRect();
    const titleBottom = section.querySelector('h3')?.getBoundingClientRect().bottom ?? box.top;
    const bodyBox = section.querySelector('p')?.getBoundingClientRect();
    const below = [...section.querySelectorAll('button')].filter(
      (b) => b.getBoundingClientRect().top >= titleBottom,
    );
    const buttons = below.map((b) => {
      const r = b.getBoundingClientRect();
      return {
        label: b.textContent ?? '',
        inside: r.left >= box.left - 1 && r.right <= box.right + 1,
        whole: b.scrollWidth <= b.clientWidth + 1,
      };
    });
    const style = getComputedStyle(section);
    return {
      // The body text starts at the card's padding, not in a column beside the icon.
      bodyIndent: bodyBox ? Math.round(bodyBox.left - box.left) : -1,
      padding: Math.round(parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth)),
      buttons,
    };
  });
  expect(layout.bodyIndent).toBeGreaterThanOrEqual(0);
  expect(layout.bodyIndent).toBeLessThanOrEqual(layout.padding + 1);
  expect(layout.buttons.length).toBeGreaterThanOrEqual(4);
  for (const b of layout.buttons) {
    expect(b.inside && b.whole, `button within the card: ${JSON.stringify(b)}`).toBe(true);
  }
  expect(unexpectedErrors(boot.pageErrors)).toEqual([]);
  await context.close();
});

// "Close to tray" and automatic update downloads do nothing on a phone (no tray; the app stores
// update the app), so App settings leaves them out; "Prevent sleep" stays (it keeps the screen on).
test('App settings leaves out the desktop-only options', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const boot = await bootApp(page, h);
  await page.locator('[data-nav-section="more"]').click();
  await page.getByRole('dialog').getByRole('button', { name: /^App/ }).first().click();
  const preventSleep = page.locator('[data-setting-anchor="app.window.preventSleep"]');
  await preventSleep.evaluate((el) => {
    const details = el.closest('details');
    if (details) details.open = true;
  });
  await expect(preventSleep).toBeVisible();
  await expect(page.locator('[data-setting-anchor="app.window.closeToTray"]')).toBeHidden();
  const updates = page.locator('details:has([data-setting-anchor="app.updates.autoDownload"])');
  await expect(updates).toHaveCount(1);
  await expect(updates).toBeHidden();
  // The sections either side of Updates are still there.
  await expect(
    page.locator('details:has([data-setting-anchor="app.window.preventSleep"])'),
  ).toBeVisible();
  await expect(
    page.locator('details:has([data-setting-anchor="app.appearance.reduceMotion"])'),
  ).toBeVisible();
  expect(unexpectedErrors(boot.pageErrors)).toEqual([]);
  await context.close();
});
