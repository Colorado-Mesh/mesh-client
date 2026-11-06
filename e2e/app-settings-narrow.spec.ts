import { expect, type Page, test } from '@playwright/test';

import {
  launchApp,
  type LaunchedApp,
  openAppTab,
  revealSettingInPage,
  teardownApp,
} from './electronApp';

const COLOR_SCHEME_ANCHOR = 'app.appearance.colorScheme';

interface ColorSchemeLayout {
  detailsOpen: boolean;
  swatchRows: { label: string | null; lines: number; right: number }[];
  scrollContainers: { right: number; overflowX: number }[];
  pageOverflowX: number;
}

/** Reads where the colour swatch rows sit and how far each enclosing scroll container overflows. */
function measureColorScheme(page: Page): Promise<ColorSchemeLayout> {
  return page.evaluate((anchorId) => {
    const details = document.querySelector<HTMLDetailsElement>(
      `[data-setting-anchor="${anchorId}"]`,
    );
    const rows = details
      ? [...details.querySelectorAll('[role="group"][aria-labelledby^="theme-color-heading-"]')]
      : [];
    const scrollContainers: ColorSchemeLayout['scrollContainers'] = [];
    for (let node = details?.parentElement ?? null; node; node = node.parentElement) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') {
        scrollContainers.push({
          right: node.getBoundingClientRect().right,
          overflowX: node.scrollWidth - node.clientWidth,
        });
      }
    }
    return {
      detailsOpen: details?.open ?? false,
      swatchRows: rows.map((row) => {
        // The swatches, not the group box: a group that does not wrap keeps its own box inside
        // the panel while its swatches run past it.
        const swatches = [...row.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
        return {
          label: row.getAttribute('aria-labelledby'),
          lines: new Set(swatches.map((r) => Math.round(r.top))).size,
          right: Math.max(...swatches.map((r) => r.right)),
        };
      }),
      scrollContainers,
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, COLOR_SCHEME_ANCHOR);
}

/**
 * App settings at phone and tablet widths. Each colour row in Color scheme holds 27 preset
 * swatches (about 750px), so below that width the row has to wrap; a scrolling strip is ruled out
 * by issue #356. The AppPanel unit test can only pin the class (jsdom has no layout); this checks
 * the laid-out result in the built app.
 */
test.describe('App settings at narrow widths', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('Color scheme swatches wrap inside the panel at 375 and 768 wide', async () => {
    launched = await launchApp();
    const { app, page } = launched;
    await openAppTab(page);
    await revealSettingInPage(page, COLOR_SCHEME_ANCHOR);

    for (const width of [375, 768]) {
      await app.evaluate(({ BrowserWindow }, w) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.setMinimumSize(360, 600);
        win?.setContentSize(w, 700);
      }, width);
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);

      const layout = await measureColorScheme(page);
      expect(layout.detailsOpen, `Color scheme open at ${width}`).toBe(true);
      expect(layout.swatchRows.length, `colour rows at ${width}`).toBeGreaterThan(0);
      expect(
        layout.scrollContainers.length,
        `App panel scroll container at ${width}`,
      ).toBeGreaterThan(0);
      const panelRight = layout.scrollContainers[0]?.right ?? width;
      for (const row of layout.swatchRows) {
        expect(row.lines, `${row.label} wraps at ${width}`).toBeGreaterThan(1);
        expect(row.right, `${row.label} inside the panel at ${width}`).toBeLessThanOrEqual(
          panelRight + 1,
        );
      }
      for (const container of layout.scrollContainers) {
        expect(container.overflowX, `sideways scroll at ${width}`).toBeLessThanOrEqual(0);
      }
      expect(layout.pageOverflowX, `page sideways scroll at ${width}`).toBeLessThanOrEqual(0);
    }
    expect(launched.crashed).toBe(false);
  });
});
