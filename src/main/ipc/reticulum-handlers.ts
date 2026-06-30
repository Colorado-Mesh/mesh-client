import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';

import type { ReticulumSidecarStatus } from '../../shared/reticulum-types';
import { sanitizeLogMessage } from '../log-service';
import {
  readFirstExistingConfig,
  showReticulumConfigImportDialog,
} from '../reticulum-config-paths';
import type { ReticulumSidecarManager } from '../reticulum-sidecar-manager';

export interface ReticulumIpcDeps {
  idleStatus: ReticulumSidecarStatus;
  ensureManager: () => ReticulumSidecarManager;
  getManager: () => ReticulumSidecarManager | null;
  getMainWindow: () => BrowserWindow | null;
}

/** Register Reticulum sidecar IPC handlers (`reticulum:*`). */
export function registerReticulumIpcHandlers(deps: ReticulumIpcDeps): void {
  const { idleStatus, ensureManager, getManager } = deps;

  ipcMain.handle('reticulum:start', async (_event, opts) => {
    try {
      console.debug('[ReticulumIPC] start');
      const m = ensureManager();
      return await m.start(opts ?? {});
    } catch (err) {
      console.error(
        '[ReticulumIPC] start failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  });

  ipcMain.handle('reticulum:stop', async () => {
    console.debug('[ReticulumIPC] stop');
    await getManager()?.stop();
  });

  ipcMain.handle('reticulum:getStatus', () => {
    return getManager()?.getStatus() ?? idleStatus;
  });

  ipcMain.handle('reticulum:proxyGet', async (_event, apiPath: string) => {
    try {
      const m = ensureManager();
      return await m.proxyGet(apiPath);
    } catch (err) {
      console.error(
        '[ReticulumIPC] proxyGet failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  });

  ipcMain.handle('reticulum:proxyPost', async (_event, apiPath: string, body: unknown) => {
    try {
      const m = ensureManager();
      return await m.proxyPost(apiPath, body);
    } catch (err) {
      console.error(
        '[ReticulumIPC] proxyPost failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  });

  ipcMain.handle('reticulum:proxyPut', async (_event, apiPath: string, body: unknown) => {
    try {
      const m = ensureManager();
      return await m.proxyPut(apiPath, body);
    } catch (err) {
      console.error(
        '[ReticulumIPC] proxyPut failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  });

  ipcMain.handle('reticulum:readDefaultConfigFile', () => readFirstExistingConfig());

  ipcMain.handle('reticulum:showConfigImportDialog', async () => showReticulumConfigImportDialog());
}

export function wireReticulumSidecarBridge(
  manager: ReticulumSidecarManager,
  getMainWindow: () => BrowserWindow | null,
): void {
  manager.on('event', (evt) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('reticulum:event', evt);
  });
  manager.on('status', (status) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('reticulum:status', status);
  });
}
