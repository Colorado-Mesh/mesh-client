import { expect, test } from '@playwright/test';

import { launchApp, type LaunchedApp, openPanel, teardownApp } from './electronApp';

test.describe('empty states', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('Connection and Chat mount disconnected empty UI', async () => {
    launched = await launchApp();
    const { page } = launched;

    await openPanel(page, 'Device', 'Connection');
    await expect(page.locator('#root')).toBeVisible();
    // Fresh profile: no last-device auto-connect — Connect control remains available.
    await expect(page.getByRole('button', { name: /connect/i }).first()).toBeVisible({
      timeout: 15_000,
    });

    await openPanel(page, 'Chat');
    await expect(
      page.getByText(/Connect to a device to start chatting|No messages yet/i).first(),
    ).toBeVisible({ timeout: 15_000 });
    expect(launched.crashed).toBe(false);
  });
});
