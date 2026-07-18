import type { BrowserWindow } from 'electron';
import { ipcMain, shell } from 'electron';

import type { ReticulumSidecarStatus } from '../../shared/reticulum-types';
import { sanitizeLogMessage } from '../log-service';
import {
  isAllowedNomadContentSourcePath,
  isNomadContentSourceApiPath,
  NOMAD_CONTENT_SOURCE_API_PATH,
  readFirstExistingConfig,
  showNomadContentSourceDialog,
  showReticulumConfigImportDialog,
} from '../reticulum-config-paths';
import { validateReticulumUserConfig } from '../reticulum-config-validate';
import { showReticulumIdentityImportDialog } from '../reticulum-identity-import';
import {
  isAllowedRncpRevealPath,
  isAllowedRncpSaveDirectoryPath,
  isAllowedRncpSendFilePath,
  isRncpPickerGatedApiPath,
  showRncpOpenFileDialog,
  showRncpSaveDirectoryDialog,
} from '../reticulum-remote-paths';
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
    if (isRncpPickerGatedApiPath(pathArg)) {
      throw new Error(
        'rncp send/fetch/listener changes require reticulum:rncpSend/rncpFetch/setRncpListener (picker-backed)',
      );
    }
    try {
      const m = ensureManager();
      return await m.proxyPost(pathArg, body);
    } catch (err) {
      logReticulumProxyFailure('proxyPost', err, pathArg);
      throw err;
    }
  });

  ipcMain.handle('reticulum:factoryReset', async (event) => {
    assertIpcSender(event, 'reticulum:factoryReset');
    try {
      const m = ensureManager();
      console.warn('[ReticulumIPC] factoryReset invoked');
      return await m.factoryReset();
    } catch (err) {
      logReticulumProxyFailure('factoryReset', err, '/api/v1/system/factory-reset');
      throw err;
    }
  });

  ipcMain.handle('reticulum:proxyPut', async (event, apiPath: unknown, body: unknown) => {
    assertIpcSender(event, 'reticulum:proxyPut');
    const pathArg = assertProxyApiPath(apiPath);
    if (isNomadContentSourceApiPath(pathArg)) {
      throw new Error(
        'Nomad content-source changes require reticulum:setNomadContentSource (picker-backed)',
      );
    }
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

  ipcMain.handle('reticulum:showNomadContentSourceDialog', async (event) => {
    assertIpcSender(event, 'reticulum:showNomadContentSourceDialog');
    return showNomadContentSourceDialog();
  });

  /**
   * Apply Nomad content source. Path must be a non-empty string matching the last
   * native folder picker result so a compromised renderer cannot expose arbitrary
   * directories.
   */
  ipcMain.handle('reticulum:setNomadContentSource', async (event, pathArg: unknown) => {
    assertIpcSender(event, 'reticulum:setNomadContentSource');
    if (typeof pathArg !== 'string') {
      throw new TypeError('Nomad content source path must be a string');
    }
    const pathVal = pathArg.trim();
    if (!pathVal) {
      return { ok: false, error: 'content_source_required' };
    }
    if (!isAllowedNomadContentSourcePath(pathVal)) {
      console.warn(
        '[ReticulumIPC] setNomadContentSource rejected path not from folder picker:',
        sanitizeLogMessage(pathVal),
      );
      return { ok: false, error: 'content_source_not_from_picker' };
    }
    try {
      const m = ensureManager();
      return await m.proxyPut(NOMAD_CONTENT_SOURCE_API_PATH, { path: pathVal });
    } catch (err) {
      logReticulumProxyFailure('setNomadContentSource', err, NOMAD_CONTENT_SOURCE_API_PATH);
      throw err;
    }
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

  // ─── rncp file dialogs (Nomad-style picker allowlist) ───────────────────

  ipcMain.handle('reticulum:showRncpOpenFileDialog', async (event) => {
    assertIpcSender(event, 'reticulum:showRncpOpenFileDialog');
    return showRncpOpenFileDialog();
  });

  ipcMain.handle('reticulum:showRncpSaveDirectoryDialog', async (event) => {
    assertIpcSender(event, 'reticulum:showRncpSaveDirectoryDialog');
    return showRncpSaveDirectoryDialog();
  });

  ipcMain.handle('reticulum:revealInFolder', (event, pathArg: unknown) => {
    assertIpcSender(event, 'reticulum:revealInFolder');
    if (typeof pathArg !== 'string' || !pathArg.trim()) {
      return { ok: false, error: 'path_required' };
    }
    if (!isAllowedRncpRevealPath(pathArg)) {
      console.warn(
        '[ReticulumIPC] revealInFolder rejected path not from picker:',
        sanitizeLogMessage(pathArg),
      );
      return { ok: false, error: 'path_not_from_picker' };
    }
    shell.showItemInFolder(pathArg);
    return { ok: true };
  });

  /**
   * Picker-gated rncp send: `path` must exactly match the last
   * {@link showRncpOpenFileDialog} result so a compromised renderer cannot
   * exfiltrate arbitrary local files via rncp.
   */
  ipcMain.handle('reticulum:rncpSend', async (event, opts: unknown) => {
    assertIpcSender(event, 'reticulum:rncpSend');
    if (!opts || typeof opts !== 'object') {
      throw new TypeError('rncpSend: opts must be an object');
    }
    const o = opts as Record<string, unknown>;
    const destinationHash = typeof o.destination_hash === 'string' ? o.destination_hash : '';
    const filePath = typeof o.path === 'string' ? o.path : '';
    if (!isAllowedRncpSendFilePath(filePath)) {
      console.warn(
        '[ReticulumIPC] rncpSend rejected path not from picker:',
        sanitizeLogMessage(filePath),
      );
      return { ok: false, error: 'path_not_from_picker' };
    }
    try {
      const m = ensureManager();
      return await m.proxyPost('/api/v1/rncp/send', {
        destination_hash: destinationHash,
        path: filePath,
      });
    } catch (err) {
      logReticulumProxyFailure('rncpSend', err, '/api/v1/rncp/send');
      throw err;
    }
  });

  /**
   * Picker-gated rncp fetch: when `save_path` is provided, it must fall
   * under the last {@link showRncpSaveDirectoryDialog} result so a
   * compromised renderer cannot direct the sidecar to write an arbitrary
   * local path. Omitting `save_path` lets the sidecar pick its own default.
   */
  ipcMain.handle('reticulum:rncpFetch', async (event, opts: unknown) => {
    assertIpcSender(event, 'reticulum:rncpFetch');
    if (!opts || typeof opts !== 'object') {
      throw new TypeError('rncpFetch: opts must be an object');
    }
    const o = opts as Record<string, unknown>;
    const destinationHash = typeof o.destination_hash === 'string' ? o.destination_hash : '';
    const remotePath = typeof o.remote_path === 'string' ? o.remote_path : '';
    const savePath =
      typeof o.save_path === 'string' && o.save_path.trim() ? o.save_path : undefined;
    if (savePath != null && !isAllowedRncpSaveDirectoryPath(savePath)) {
      console.warn(
        '[ReticulumIPC] rncpFetch rejected save_path not from picker:',
        sanitizeLogMessage(savePath),
      );
      return { ok: false, error: 'save_path_not_from_picker' };
    }
    try {
      const m = ensureManager();
      return await m.proxyPost('/api/v1/rncp/fetch', {
        destination_hash: destinationHash,
        remote_path: remotePath,
        save_path: savePath,
      });
    } catch (err) {
      logReticulumProxyFailure('rncpFetch', err, '/api/v1/rncp/fetch');
      throw err;
    }
  });

  /**
   * Picker-gated rncp listener config: `save_dir` / `fetch_jail` (when set)
   * must fall under the last {@link showRncpSaveDirectoryDialog} result —
   * `fetch_jail` in particular controls which local files remote peers may
   * read via rncp fetch, so it is exactly as sensitive as Nomad's watched
   * content-source directory.
   */
  ipcMain.handle('reticulum:setRncpListener', async (event, opts: unknown) => {
    assertIpcSender(event, 'reticulum:setRncpListener');
    if (!opts || typeof opts !== 'object') {
      throw new TypeError('setRncpListener: opts must be an object');
    }
    const o = opts as Record<string, unknown>;
    const saveDir = typeof o.save_dir === 'string' && o.save_dir.trim() ? o.save_dir : undefined;
    const fetchJail =
      typeof o.fetch_jail === 'string' && o.fetch_jail.trim() ? o.fetch_jail : undefined;
    if (saveDir != null && !isAllowedRncpSaveDirectoryPath(saveDir)) {
      console.warn(
        '[ReticulumIPC] setRncpListener rejected save_dir not from picker:',
        sanitizeLogMessage(saveDir),
      );
      return { ok: false, error: 'save_dir_not_from_picker' };
    }
    if (fetchJail != null && !isAllowedRncpSaveDirectoryPath(fetchJail)) {
      console.warn(
        '[ReticulumIPC] setRncpListener rejected fetch_jail not from picker:',
        sanitizeLogMessage(fetchJail),
      );
      return { ok: false, error: 'fetch_jail_not_from_picker' };
    }
    const allowed = Array.isArray(o.allowed)
      ? o.allowed.filter((v): v is string => typeof v === 'string')
      : [];
    const blocked = Array.isArray(o.blocked)
      ? o.blocked.filter((v): v is string => typeof v === 'string')
      : [];
    try {
      const m = ensureManager();
      return await m.proxyPost('/api/v1/rncp/listener', {
        enabled: o.enabled === true,
        save_dir: saveDir,
        allow_fetch: o.allow_fetch === true,
        fetch_jail: fetchJail,
        overwrite: o.overwrite === true,
        allowed,
        blocked,
      });
    } catch (err) {
      logReticulumProxyFailure('setRncpListener', err, '/api/v1/rncp/listener');
      throw err;
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
