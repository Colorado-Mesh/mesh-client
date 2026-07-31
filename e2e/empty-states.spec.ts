import { expect, test } from '@playwright/test';

import { expectTabSelected, launchApp, type LaunchedApp, teardownApp } from './electronApp';

test.describe('empty states', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('Connection and Chat mount disconnected empty UI', async () => {
    launched = await launchApp();
    const { page } = launched;
    const tablist = page.getByRole('tablist', { name: 'Application panels' });

    await tablist.getByRole('tab', { name: 'Connection' }).click();
    await expectTabSelected(page, 'Connection');
    await expect(page.locator('#root')).toBeVisible();
    // Fresh profile: no last-device auto-connect — Connect control remains available.
    await expect(page.getByRole('button', { name: /connect/i }).first()).toBeVisible({
      timeout: 15_000,
    });

    await tablist.getByRole('tab', { name: 'Chat' }).click();
    await expectTabSelected(page, 'Chat');
    await expect(
      page.getByText(/Connect to a device to start chatting|No messages yet/i).first(),
    ).toBeVisible({ timeout: 15_000 });
    expect(launched.crashed).toBe(false);
  });
});
