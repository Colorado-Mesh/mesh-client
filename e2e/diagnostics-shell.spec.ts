import { expect, test } from '@playwright/test';

import { expectTabSelected, launchApp, type LaunchedApp, teardownApp } from './electronApp';

test.describe('diagnostics shell', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('mounts diagnostics panel heading without live RF rows', async () => {
    launched = await launchApp();
    const { page } = launched;
    const tablist = page.getByRole('tablist', { name: 'Application panels' });

    await tablist.getByRole('tab', { name: 'Diagnostics' }).click();
    await expectTabSelected(page, 'Diagnostics');
    await expect(page.getByRole('heading', { name: 'Network Diagnostics' })).toBeVisible();
    expect(launched.crashed).toBe(false);
  });
});
