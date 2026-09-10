import { expect, test } from '@playwright/test';

import type { ElectronAPI } from '../src/shared/electron-api.types';
import { launchApp, type LaunchedApp, teardownApp } from './electronApp';

test.describe('macOS unread Dock badge', () => {
  test.skip(process.platform !== 'darwin', 'Dock badge is a macOS API');
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('updates through preload IPC, restores on focus, and clears when read', async () => {
    launched = await launchApp();
    const { app, page } = launched;

    await page.evaluate(() => {
      (window as unknown as { electronAPI: ElectronAPI }).electronAPI.setTrayUnread(3);
    });
    await expect.poll(() => app.evaluate(({ app }) => app.dock?.getBadge())).toBe('3');

    await app.evaluate(({ app, BrowserWindow }) => {
      app.dock?.setBadge('');
      BrowserWindow.getAllWindows()[0].emit('focus');
    });
    await expect.poll(() => app.evaluate(({ app }) => app.dock?.getBadge())).toBe('3');

    await page.evaluate(() => {
      (window as unknown as { electronAPI: ElectronAPI }).electronAPI.setTrayUnread(0);
    });
    await expect.poll(() => app.evaluate(({ app }) => app.dock?.getBadge())).toBe('');
  });
});
