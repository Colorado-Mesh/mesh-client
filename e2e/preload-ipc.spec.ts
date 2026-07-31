import { expect, test } from '@playwright/test';

import { launchApp, type LaunchedApp, teardownApp } from './electronApp';

test.describe('preload IPC', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('exposes electronAPI without leaking ipcRenderer', async () => {
    launched = await launchApp();
    const { page } = launched;

    const bridge = await page.evaluate(() => {
      const w = window as Window & {
        electronAPI?: {
          getPlatform?: () => string;
          appSettings?: { getAll?: () => Promise<unknown> };
        };
        ipcRenderer?: unknown;
        require?: unknown;
      };
      return {
        hasElectronApi: typeof w.electronAPI === 'object' && w.electronAPI != null,
        hasIpcRenderer: typeof w.ipcRenderer !== 'undefined',
        hasRequire: typeof w.require === 'function',
        platform: w.electronAPI?.getPlatform?.() ?? null,
      };
    });

    expect(bridge.hasElectronApi).toBe(true);
    expect(bridge.hasIpcRenderer).toBe(false);
    expect(bridge.hasRequire).toBe(false);
    expect(bridge.platform).toBe(process.platform);

    const settings = await page.evaluate(async () => {
      const api = (
        window as unknown as {
          electronAPI: { appSettings: { getAll: () => Promise<Record<string, string>> } };
        }
      ).electronAPI;
      return api.appSettings.getAll();
    });
    expect(settings).toBeTruthy();
    expect(typeof settings).toBe('object');
  });
});
