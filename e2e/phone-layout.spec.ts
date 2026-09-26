import { expect, test } from '@playwright/test';

import { launchApp, type LaunchedApp, teardownApp } from './electronApp';

/**
 * Phone-sized window (future iOS / Android builds): the rail becomes a bottom bar with Incident
 * always on it, and More opens the launcher sheet with the protocol switcher. The desktop minimum
 * window size stays 900x600; only this test lowers it.
 */
test.describe('phone layout', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('bottom bar, More sheet and protocol switch at 390x844', async () => {
    launched = await launchApp();
    const { app, page } = launched;
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.setMinimumSize(360, 600);
      win?.setContentSize(390, 844);
    });
    const nav = page.getByRole('navigation', { name: 'Application panels' });
    await expect(nav.getByRole('button', { name: /^More/ })).toBeVisible();
    await expect(nav.getByRole('button', { name: /^Incident/ })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Protocol switcher' })).toHaveCount(0);

    await nav.getByRole('button', { name: /^Chat/ }).click();
    await expect(nav.getByRole('button', { name: /^Chat/ })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await nav.getByRole('button', { name: /^More/ }).click();
    const sheet = page.getByRole('dialog', { name: 'All panels' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('radio', { name: 'Switch to MeshCore' }).click();
    await expect(sheet.getByRole('radio', { name: 'Switch to MeshCore' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowX).toBeLessThanOrEqual(0);
    expect(launched.crashed).toBe(false);
  });
});
