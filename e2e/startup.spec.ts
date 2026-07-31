import { expect, test } from '@playwright/test';

import { launchApp, type LaunchedApp, teardownApp } from './electronApp';

test.describe('startup', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('launches main window with protocol switcher', async () => {
    launched = await launchApp();
    const { page } = launched;

    await expect(page).toHaveTitle('Mesh Client');
    await expect(page.locator('#root')).toBeVisible();

    const switcher = page.getByRole('group', { name: 'Protocol switcher' });
    await expect(switcher).toBeVisible();
    await expect(switcher.getByRole('button', { name: 'Switch to Meshtastic' })).toBeVisible();
    await expect(switcher.getByRole('button', { name: 'Switch to MeshCore' })).toBeVisible();
    await expect(switcher.getByRole('button', { name: 'Switch to Reticulum' })).toBeVisible();

    expect(launched.crashed).toBe(false);
    expect(launched.didFailLoad).toBe(false);
  });
});
