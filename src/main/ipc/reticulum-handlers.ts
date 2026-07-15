import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';

import type { ReticulumSidecarStatus } from '../../shared/reticulum-types';
import { sanitizeLogMessage } from '../log-service';
import {
  readFirstExistingConfig,
  showReticulumConfigImportDialog,
} from '../reticulum-config-paths';
import { validateReticulumUserConfig } from '../reticulum-config-validate';
import { showReticulumIdentityImportDialog } from '../reticulum-identity-import';
import type { ReticulumSidecarManager } from '../reticulum-sidecar-manager';
import { parseEnabledInterfaceNames } from '../reticulumInterfaceIssueScope';
import { assertIpcSender } from '../validate-ipc-sender';

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

function assertProxyApiPath(apiPath: unknown): string {
  if (typeof apiPath !== 'string') {
    throw new Error('Reticulum proxy path must be a string');
  }
  return apiPath;
}

/** Register Reticulum sidecar IPC handlers (`reticulum:*`). */
export function registerReticulumIpcHandlers(deps: ReticulumIpcDeps): void {
  const { idleStatus, ensureManager, getManager } = deps;

  ipcMain.handle('reticulum:start', async (event, opts) => {
    assertIpcSender(event, 'reticulum:start');
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

  ipcMain.handle('reticulum:stop', async (event) => {
    assertIpcSender(event, 'reticulum:stop');
    console.debug('[ReticulumIPC] stop');
    await getManager()?.stop();
  });

  ipcMain.handle('reticulum:getStatus', (event) => {
    assertIpcSender(event, 'reticulum:getStatus');
    return getManager()?.getStatus() ?? idleStatus;
  });

  ipcMain.handle('reticulum:syncInterfaceIssueScope', (event, enabledInterfaceNames: unknown) => {
    assertIpcSender(event, 'reticulum:syncInterfaceIssueScope');
    const names = parseEnabledInterfaceNames(enabledInterfaceNames);
    const m = getManager();
    if (!m) return idleStatus;
    return m.syncInterfaceIssueScope(names);
  });

  ipcMain.handle('reticulum:proxyGet', async (event, apiPath: unknown) => {
    assertIpcSender(event, 'reticulum:proxyGet');
    const pathArg = assertProxyApiPath(apiPath);
    try {
      const m = ensureManager();
      return await m.proxyGet(pathArg);
    } catch (err) {
      logReticulumProxyFailure('proxyGet', err, pathArg);
      throw err;
    }
  });

  ipcMain.handle('reticulum:proxyPost', async (event, apiPath: unknown, body: unknown) => {
    assertIpcSender(event, 'reticulum:proxyPost');
    const pathArg = assertProxyApiPath(apiPath);
    try {
      const m = ensureManager();
      return await m.proxyPost(pathArg, body);
    } catch (err) {
      logReticulumProxyFailure('proxyPost', err, pathArg);
      throw err;
    }
  });

  ipcMain.handle('reticulum:proxyPut', async (event, apiPath: unknown, body: unknown) => {
    assertIpcSender(event, 'reticulum:proxyPut');
    const pathArg = assertProxyApiPath(apiPath);
    try {
      const m = ensureManager();
      return await m.proxyPut(pathArg, body);
    } catch (err) {
      logReticulumProxyFailure('proxyPut', err, pathArg);
      throw err;
    }
  });

  ipcMain.handle('reticulum:proxyDelete', async (event, apiPath: unknown) => {
    assertIpcSender(event, 'reticulum:proxyDelete');
    const pathArg = assertProxyApiPath(apiPath);
    try {
      const m = ensureManager();
      return await m.proxyDelete(pathArg);
    } catch (err) {
      logReticulumProxyFailure('proxyDelete', err, pathArg);
      throw err;
    }
  });

  ipcMain.handle('reticulum:readDefaultConfigFile', (event) => {
    assertIpcSender(event, 'reticulum:readDefaultConfigFile');
    return readFirstExistingConfig();
  });

  ipcMain.handle('reticulum:showConfigImportDialog', async (event) => {
    assertIpcSender(event, 'reticulum:showConfigImportDialog');
    return showReticulumConfigImportDialog();
  });

  ipcMain.handle('reticulum:showIdentityImportDialog', async (event) => {
    assertIpcSender(event, 'reticulum:showIdentityImportDialog');
    return showReticulumIdentityImportDialog();
  });

  ipcMain.handle('reticulum:validateConfig', async (event) => {
    assertIpcSender(event, 'reticulum:validateConfig');
    try {
      return await validateReticulumUserConfig();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[ReticulumIPC] validateConfig failed:', sanitizeLogMessage(message));
      return { ok: false, issues: [], error: sanitizeLogMessage(message) };
    }
  });
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
