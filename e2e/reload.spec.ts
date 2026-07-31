import { expect, test } from '@playwright/test';

import { launchApp, type LaunchedApp, teardownApp } from './electronApp';

test.describe('reload', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('recovers UI after renderer reload', async () => {
    launched = await launchApp();
    const { page } = launched;

    await page.reload();
    await page.waitForSelector('#root', { state: 'visible', timeout: 45_000 });
    await expect(page.getByRole('group', { name: 'Protocol switcher' })).toBeVisible({
      timeout: 45_000,
    });
    expect(launched.crashed).toBe(false);
  });
});
