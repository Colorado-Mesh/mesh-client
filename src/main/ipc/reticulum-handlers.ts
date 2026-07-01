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

function isExpectedReticulumProxyError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('not running') ||
    message.includes('404') ||
    lower.includes('fetch failed') ||
    lower.includes('aborted') ||
    lower.includes('timeout')
  );
}

function logReticulumProxyFailure(method: string, err: unknown, apiPath?: string): void {
  const message = err instanceof Error ? err.message : String(err);
  const log = isExpectedReticulumProxyError(message) ? console.debug : console.error;
  const pathSuffix = apiPath ? ` path=${apiPath}` : '';
  log(`[ReticulumIPC] ${method} failed${pathSuffix}:`, sanitizeLogMessage(message));
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
      logReticulumProxyFailure('proxyGet', err, apiPath);
      throw err;
    }
  });

  ipcMain.handle('reticulum:proxyPost', async (_event, apiPath: string, body: unknown) => {
    try {
      const m = ensureManager();
      return await m.proxyPost(apiPath, body);
    } catch (err) {
      logReticulumProxyFailure('proxyPost', err);
      throw err;
    }
  });

  ipcMain.handle('reticulum:proxyPut', async (_event, apiPath: string, body: unknown) => {
    try {
      const m = ensureManager();
      return await m.proxyPut(apiPath, body);
    } catch (err) {
      logReticulumProxyFailure('proxyPut', err);
      throw err;
    }
  });

  ipcMain.handle('reticulum:proxyDelete', async (_event, apiPath: string) => {
    try {
      const m = ensureManager();
      return await m.proxyDelete(apiPath);
    } catch (err) {
      logReticulumProxyFailure('proxyDelete', err);
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
