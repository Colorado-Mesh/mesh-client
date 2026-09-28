import { expect, test } from '@playwright/test';

import { launchApp, type LaunchedApp, openPanel, teardownApp } from './electronApp';

test.describe('diagnostics shell', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('mounts diagnostics panel heading without live RF rows', async () => {
    launched = await launchApp();
    const { page } = launched;

    await openPanel(page, 'Monitor', 'Diagnostics');
    await expect(page.getByRole('heading', { name: 'Network Diagnostics' })).toBeVisible();
    expect(launched.crashed).toBe(false);
  });
});
