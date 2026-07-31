import { expect, test } from '@playwright/test';

import {
  filterUnexpectedConsoleErrors,
  launchApp,
  type LaunchedApp,
  teardownApp,
} from './electronApp';

test.describe('window lifecycle', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('respects minimum size and exits cleanly', async () => {
    launched = await launchApp();
    const { page, app } = launched;

    const bounds = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return null;
      const b = win.getBounds();
      const min = win.getMinimumSize();
      return { width: b.width, height: b.height, minWidth: min[0], minHeight: min[1] };
    });
    expect(bounds).toBeTruthy();
    expect(bounds!.minWidth).toBeGreaterThan(0);
    expect(bounds!.minHeight).toBeGreaterThan(0);
    expect(bounds!.width).toBeGreaterThanOrEqual(bounds!.minWidth);
    expect(bounds!.height).toBeGreaterThanOrEqual(bounds!.minHeight);

    const unexpected = filterUnexpectedConsoleErrors(launched.rendererConsoleErrors);
    expect(unexpected, `unexpected console.error: ${unexpected.join(' | ')}`).toEqual([]);

    await page.close();
    await app.close();
    expect(launched.crashed).toBe(false);
  });
});
