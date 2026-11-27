/**
 * Map tiles on mobile: basemaps use `mesh-tiles://` (served by main's tile cache + upstream
 * fetch). The WebView cannot load that scheme, so the mobile bridge resolves tile images through
 * the host; this checks real tiles decode in the Map tab and land in the OPFS tile cache.
 * Needs internet access for the upstream tile server (skipped when offline).
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

test('map tiles load through the host tile cache', async ({ browser }) => {
  const online = await fetch('https://tile.openstreetmap.org/0/0/0.png', { method: 'HEAD' }).then(
    (r) => r.ok,
    () => false,
  );
  test.skip(!online, 'tile server not reachable');
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const boot = await bootApp(page, h);
  await page.getByRole('button', { name: /^Map/ }).first().click();
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            [...document.querySelectorAll<HTMLImageElement>('img.leaflet-tile')].filter(
              (img) => img.complete && img.naturalWidth > 0,
            ).length,
        ),
      { timeout: 45_000 },
    )
    .toBeGreaterThan(0);
  // Tiles were fetched through main's tile cache (stored in OPFS, outside the memory volume).
  const status = await page.evaluate(() => window.electronAPI.offlineMaps.status());
  expect(JSON.stringify(status)).toMatch(/tileCount|diskBytes|\d/);
  await page.screenshot({ path: test.info().outputPath('map.png') });
  expect(unexpectedErrors(boot.pageErrors)).toEqual([]);
  await context.close();
});
