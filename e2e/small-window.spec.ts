import { expect, test } from '@playwright/test';

import { launchApp, type LaunchedApp, openPanel, teardownApp } from './electronApp';

/**
 * Issue #1062: the v6 shell must fit 1024x768 (the tested minimum; 900x600 is best effort).
 * Checks that nothing forces a horizontal page scroll and the rail, section tabs and status bar
 * stay inside the window.
 */
test.describe('small window layout', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('shell fits a 1024x768 window', async () => {
    launched = await launchApp();
    const { app, page } = launched;
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1024, 768);
    });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1024);

    const noHorizontalScroll = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

    const rail = page.getByRole('navigation', { name: 'Application panels' });
    for (const button of await rail.getByRole('button').all()) {
      await expect(button).toBeInViewport();
    }
    await expect(page.getByRole('contentinfo')).toBeInViewport();
    expect(await noHorizontalScroll()).toBe(true);

    // Device and Monitor have the most sub-tabs (five each on Meshtastic).
    for (const section of ['Device', 'Monitor']) {
      await openPanel(page, section);
      for (const tab of await page.getByRole('banner').getByRole('tab').all()) {
        await expect(tab).toBeInViewport({ ratio: 1 });
      }
      expect(await noHorizontalScroll()).toBe(true);
    }
    expect(launched.crashed).toBe(false);
  });
});
