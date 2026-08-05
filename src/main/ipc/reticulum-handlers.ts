import type { BrowserWindow } from 'electron';
import { ipcMain, shell } from 'electron';

import { isGamesApiPath, parseGamesActionRequest } from '../../shared/games-types';
import type {
  ReticulumSidecarStartOptions,
  ReticulumSidecarStatus,
} from '../../shared/reticulum-types';
import { canonicalizeReticulumDestinationHash } from '../../shared/reticulumDestinationHash';
import {
  isExpectedReticulumProxyError,
  type ReticulumProxyIpcErrorEnvelope,
  reticulumProxyIpcErrorEnvelope,
} from '../../shared/reticulumProxyIpcError';
import { MS_PER_MINUTE } from '../../shared/timeConstants';
import { parseVoiceAudioRequest, VOICE_AUDIO_API_PATH } from '../../shared/voice-types';
import { createIpcRateLimiter } from '../ipcRateLimit';
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

/** Shared rolling window for all reticulum proxy verbs (Get/Post/Put/Delete). */
const reticulumProxyIpcRateLimit = createIpcRateLimiter({
  max: 300,
  windowMs: MS_PER_MINUTE,
  label: 'reticulum:proxy',
});

/**
 * Realtime LXST PCM ingest: QualityHigh is ~16.7 frames/s (~1000/min).
 * Separate from the shared 300/min proxy bucket so calls do not starve mesh control IPC.
 */
const reticulumVoiceAudioIpcRateLimit = createIpcRateLimiter({
  max: 2000,
  windowMs: MS_PER_MINUTE,
  label: 'reticulum:voiceSendAudio',
});

/**
 * LRGP games control/poll traffic. Own bucket so session polls + moves do not
 * starve the shared 300/min reticulum proxy ceiling.
 */
const reticulumGamesIpcRateLimit = createIpcRateLimiter({
  max: 600,
  windowMs: MS_PER_MINUTE,
  label: 'reticulum:games',
});

function isVoiceAudioApiPath(apiPath: string): boolean {
  return apiPath === VOICE_AUDIO_API_PATH;
}

function assertGamesSessionId(sessionId: unknown): string | { error: string } {
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 128) {
    return { error: 'invalid_session_id' };
  }
  return sessionId;
}

export interface ReticulumIpcDeps {
  idleStatus: ReticulumSidecarStatus;
  ensureManager: () => ReticulumSidecarManager;
  getManager: () => ReticulumSidecarManager | null;
  getMainWindow: () => BrowserWindow | null;
}

function parseReticulumStartOptions(opts: unknown): ReticulumSidecarStartOptions {
  if (opts == null) return {};
  if (typeof opts !== 'object' || Array.isArray(opts)) {
    throw new Error('reticulum:start options must be an object');
  }
  const reuseIfRunning = (opts as Record<string, unknown>).reuseIfRunning;
  if (reuseIfRunning != null && typeof reuseIfRunning !== 'boolean') {
    throw new Error('reticulum:start reuseIfRunning must be boolean');
  }
  return reuseIfRunning == null ? {} : { reuseIfRunning };
}

function logReticulumProxyFailure(method: string, err: unknown, apiPath?: string): void {
  const message = err instanceof Error ? err.message : String(err);
  const log = isExpectedReticulumProxyError(err) ? console.debug : console.error;
  const pathSuffix = apiPath ? ` path=${apiPath}` : '';
  log(`[ReticulumIPC] ${method} failed${pathSuffix}:`, sanitizeLogMessage(message));
}

/**
 * Expected restart/transient failures: return an envelope (preload rethrows) so
 * Electron does not emit `[error] Error occurred in handler for 'reticulum:proxy*'`.
 * Unexpected failures still throw.
 */
function settleReticulumProxyFailure(
  method: string,
  err: unknown,
  apiPath?: string,
): ReticulumProxyIpcErrorEnvelope {
  logReticulumProxyFailure(method, err, apiPath);
  const message = err instanceof Error ? err.message : String(err);
  if (isExpectedReticulumProxyError(err)) {
    return reticulumProxyIpcErrorEnvelope(sanitizeLogMessage(message));
  }
  throw err;
}

function assertProxyApiPath(apiPath: unknown): string {
  if (typeof apiPath !== 'string') {
    throw new Error('Reticulum proxy path must be a string');
  }
  return apiPath;
}

/**
 * Requirement + picker-allowlist checks for `reticulum:setRncpListener` dirs.
 * Returns the rejection error code, or null when the config is acceptable.
 */
function validateRncpListenerDirs(opts: {
  enabled: boolean;
  allowFetch: boolean;
  saveDir?: string;
  fetchJail?: string;
}): string | null {
  const { enabled, allowFetch, saveDir, fetchJail } = opts;
  if (enabled && saveDir == null) {
    console.warn('[ReticulumIPC] setRncpListener rejected: save_dir required when enabled');
    return 'save_dir_required';
  }
  if (allowFetch && fetchJail == null) {
    console.warn(
      '[ReticulumIPC] setRncpListener rejected: fetch_jail required when allow_fetch is true',
    );
    return 'fetch_jail_required';
  }
  if (saveDir != null && !isAllowedRncpSaveDirectoryPath(saveDir)) {
    console.warn(
      '[ReticulumIPC] setRncpListener rejected save_dir not from picker:',
      sanitizeLogMessage(saveDir),
    );
    return 'save_dir_not_from_picker';
  }
  if (fetchJail != null && !isAllowedRncpSaveDirectoryPath(fetchJail)) {
    console.warn(
      '[ReticulumIPC] setRncpListener rejected fetch_jail not from picker:',
      sanitizeLogMessage(fetchJail),
    );
    return 'fetch_jail_not_from_picker';
  }
  return null;
}

/** Register Reticulum sidecar IPC handlers (`reticulum:*`). */
export function registerReticulumIpcHandlers(deps: ReticulumIpcDeps): void {
  const { idleStatus, ensureManager, getManager } = deps;

  ipcMain.handle('reticulum:start', async (event, opts: unknown) => {
    assertIpcSender(event, 'reticulum:start');
    try {
      console.debug('[ReticulumIPC] start');
      const m = ensureManager();
      return await m.start(parseReticulumStartOptions(opts));
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
    try {
      console.debug('[ReticulumIPC] stop');
      await getManager()?.stop();
    } catch (err) {
      console.error(
        '[ReticulumIPC] stop failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
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
    reticulumProxyIpcRateLimit.checkOrThrow();
    const pathArg = assertProxyApiPath(apiPath);
    if (isGamesApiPath(pathArg)) {
      throw new Error('LRGP games require reticulum:games* IPC channels');
    }
    try {
      const m = ensureManager();
      return await m.proxyGet(pathArg);
    } catch (err) {
      // catch-no-log-ok settleReticulumProxyFailure logs expected failures / rethrows unexpected
      return settleReticulumProxyFailure('proxyGet', err, pathArg);
    }
  });

  ipcMain.handle('reticulum:proxyPost', async (event, apiPath: unknown, body: unknown) => {
    assertIpcSender(event, 'reticulum:proxyPost');
    reticulumProxyIpcRateLimit.checkOrThrow();
    const pathArg = assertProxyApiPath(apiPath);
    if (isRncpPickerGatedApiPath(pathArg)) {
      throw new Error(
        'rncp send/fetch/listener changes require reticulum:rncpSend/rncpFetch/setRncpListener (picker-backed)',
      );
    }
    if (isVoiceAudioApiPath(pathArg)) {
      throw new Error('voice PCM ingest requires reticulum:voiceSendAudio');
    }
    if (isGamesApiPath(pathArg)) {
      throw new Error('LRGP games require reticulum:games* IPC channels');
    }
    try {
      const m = ensureManager();
      return await m.proxyPost(pathArg, body);
    } catch (err) {
      // catch-no-log-ok settleReticulumProxyFailure logs expected failures / rethrows unexpected
      return settleReticulumProxyFailure('proxyPost', err, pathArg);
    }
  });

  /**
   * Realtime LXST PCM frames. Uses a dedicated rate limit (not the shared 300/min
   * proxy ceiling) so voice TX does not starve control-plane proxy IPC.
   */
  ipcMain.handle('reticulum:voiceSendAudio', async (event, opts: unknown) => {
    assertIpcSender(event, 'reticulum:voiceSendAudio');
    reticulumVoiceAudioIpcRateLimit.checkOrThrow();
    const parsed = parseVoiceAudioRequest(opts);
    if ('error' in parsed) {
      return { ok: false, error: parsed.error };
    }
    try {
      const m = ensureManager();
      return await m.proxyPost(VOICE_AUDIO_API_PATH, parsed);
    } catch (err) {
      // catch-no-log-ok settleReticulumProxyFailure logs expected failures / rethrows unexpected
      return settleReticulumProxyFailure('voiceSendAudio', err, VOICE_AUDIO_API_PATH);
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
    reticulumProxyIpcRateLimit.checkOrThrow();
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
      // catch-no-log-ok settleReticulumProxyFailure logs expected failures / rethrows unexpected
      return settleReticulumProxyFailure('proxyPut', err, pathArg);
    }
  });

  ipcMain.handle('reticulum:proxyDelete', async (event, apiPath: unknown) => {
    assertIpcSender(event, 'reticulum:proxyDelete');
    reticulumProxyIpcRateLimit.checkOrThrow();
    const pathArg = assertProxyApiPath(apiPath);
    if (isGamesApiPath(pathArg)) {
      throw new Error('LRGP games require reticulum:games* IPC channels');
    }
    try {
      const m = ensureManager();
      return await m.proxyDelete(pathArg);
    } catch (err) {
      // catch-no-log-ok settleReticulumProxyFailure logs expected failures / rethrows unexpected
      return settleReticulumProxyFailure('proxyDelete', err, pathArg);
    }
  });

  /** Dedicated LRGP games channels — blocked on generic proxyGet/Post/Delete. */
  ipcMain.handle('reticulum:gamesStatus', async (event) => {
    assertIpcSender(event, 'reticulum:gamesStatus');
    reticulumGamesIpcRateLimit.checkOrThrow();
    try {
      return await ensureManager().proxyGet('/api/v1/games/status');
    } catch (err) {
      // catch-no-log-ok settleReticulumProxyFailure logs expected failures / rethrows unexpected
      return settleReticulumProxyFailure('gamesStatus', err, '/api/v1/games/status');
    }
  });

  ipcMain.handle('reticulum:gamesApps', async (event) => {
    assertIpcSender(event, 'reticulum:gamesApps');
    reticulumGamesIpcRateLimit.checkOrThrow();
    try {
      return await ensureManager().proxyGet('/api/v1/games/apps');
    } catch (err) {
      // catch-no-log-ok settleReticulumProxyFailure logs expected failures / rethrows unexpected
      return settleReticulumProxyFailure('gamesApps', err, '/api/v1/games/apps');
    }
  });

  ipcMain.handle('reticulum:gamesSessions', async (event, peer: unknown) => {
    assertIpcSender(event, 'reticulum:gamesSessions');
    reticulumGamesIpcRateLimit.checkOrThrow();
    const q =
      typeof peer === 'string' && peer.length > 0
        ? `/api/v1/games/sessions?peer=${encodeURIComponent(peer)}`
        : '/api/v1/games/sessions';
    try {
      return await ensureManager().proxyGet(q);
    } catch (err) {
      // catch-no-log-ok settleReticulumProxyFailure logs expected failures / rethrows unexpected
      return settleReticulumProxyFailure('gamesSessions', err, q);
    }
  });

  ipcMain.handle('reticulum:gamesSessionDetail', async (event, sessionId: unknown) => {
    assertIpcSender(event, 'reticulum:gamesSessionDetail');
    reticulumGamesIpcRateLimit.checkOrThrow();
    const idOrErr = assertGamesSessionId(sessionId);
    if (typeof idOrErr !== 'string') {
      return { ok: false, error: idOrErr.error };
    }
    const path = `/api/v1/games/sessions/${encodeURIComponent(idOrErr)}`;
    try {
      return await ensureManager().proxyGet(path);
    } catch (err) {
      // catch-no-log-ok settleReticulumProxyFailure logs expected failures / rethrows unexpected
      return settleReticulumProxyFailure('gamesSessionDetail', err, path);
    }
  });

  ipcMain.handle('reticulum:gamesAction', async (event, opts: unknown) => {
    assertIpcSender(event, 'reticulum:gamesAction');
    reticulumGamesIpcRateLimit.checkOrThrow();
    const parsed = parseGamesActionRequest(opts);
    if ('error' in parsed) {
      return { ok: false, error: parsed.error };
    }
    try {
      return await ensureManager().proxyPost('/api/v1/games/action', parsed);
    } catch (err) {
      // catch-no-log-ok settleReticulumProxyFailure logs expected failures / rethrows unexpected
      return settleReticulumProxyFailure('gamesAction', err, '/api/v1/games/action');
    }
  });

  ipcMain.handle('reticulum:gamesResend', async (event, sessionId: unknown) => {
    assertIpcSender(event, 'reticulum:gamesResend');
    reticulumGamesIpcRateLimit.checkOrThrow();
    const idOrErr = assertGamesSessionId(sessionId);
    if (typeof idOrErr !== 'string') {
      return { ok: false, error: idOrErr.error };
    }
    const path = `/api/v1/games/sessions/${encodeURIComponent(idOrErr)}/resend`;
    try {
      return await ensureManager().proxyPost(path, {});
    } catch (err) {
      // catch-no-log-ok settleReticulumProxyFailure logs expected failures / rethrows unexpected
      return settleReticulumProxyFailure('gamesResend', err, path);
    }
  });

  ipcMain.handle('reticulum:gamesMarkRead', async (event, sessionId: unknown) => {
    assertIpcSender(event, 'reticulum:gamesMarkRead');
    reticulumGamesIpcRateLimit.checkOrThrow();
    const idOrErr = assertGamesSessionId(sessionId);
    if (typeof idOrErr !== 'string') {
      return { ok: false, error: idOrErr.error };
    }
    const path = `/api/v1/games/sessions/${encodeURIComponent(idOrErr)}/read`;
    try {
      return await ensureManager().proxyPost(path, {});
    } catch (err) {
      // catch-no-log-ok settleReticulumProxyFailure logs expected failures / rethrows unexpected
      return settleReticulumProxyFailure('gamesMarkRead', err, path);
    }
  });

  ipcMain.handle('reticulum:gamesDeleteSession', async (event, sessionId: unknown) => {
    assertIpcSender(event, 'reticulum:gamesDeleteSession');
    reticulumGamesIpcRateLimit.checkOrThrow();
    const idOrErr = assertGamesSessionId(sessionId);
    if (typeof idOrErr !== 'string') {
      return { ok: false, error: idOrErr.error };
    }
    const path = `/api/v1/games/sessions/${encodeURIComponent(idOrErr)}`;
    try {
      return await ensureManager().proxyDelete(path);
    } catch (err) {
      // catch-no-log-ok settleReticulumProxyFailure logs expected failures / rethrows unexpected
      return settleReticulumProxyFailure('gamesDeleteSession', err, path);
    }
  });

  ipcMain.handle('reticulum:readDefaultConfigFile', (event) => {
    assertIpcSender(event, 'reticulum:readDefaultConfigFile');
    return readFirstExistingConfig();
  });

  ipcMain.handle('reticulum:showConfigImportDialog', async (event) => {
    assertIpcSender(event, 'reticulum:showConfigImportDialog');
    try {
      return await showReticulumConfigImportDialog();
    } catch (err) {
      console.error(
        '[ReticulumIPC] showConfigImportDialog failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  });

  ipcMain.handle('reticulum:showIdentityImportDialog', async (event) => {
    assertIpcSender(event, 'reticulum:showIdentityImportDialog');
    try {
      return await showReticulumIdentityImportDialog();
    } catch (err) {
      console.error(
        '[ReticulumIPC] showIdentityImportDialog failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  });

  ipcMain.handle('reticulum:showNomadContentSourceDialog', async (event) => {
    assertIpcSender(event, 'reticulum:showNomadContentSourceDialog');
    try {
      return await showNomadContentSourceDialog();
    } catch (err) {
      console.error(
        '[ReticulumIPC] showNomadContentSourceDialog failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
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
    try {
      return await showRncpOpenFileDialog();
    } catch (err) {
      console.error(
        '[ReticulumIPC] showRncpOpenFileDialog failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  });

  ipcMain.handle('reticulum:showRncpSaveDirectoryDialog', async (event) => {
    assertIpcSender(event, 'reticulum:showRncpSaveDirectoryDialog');
    try {
      return await showRncpSaveDirectoryDialog();
    } catch (err) {
      console.error(
        '[ReticulumIPC] showRncpSaveDirectoryDialog failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
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
    reticulumProxyIpcRateLimit.checkOrThrow();
    if (!opts || typeof opts !== 'object') {
      throw new TypeError('rncpSend: opts must be an object');
    }
    const o = opts as Record<string, unknown>;
    const destinationHash = canonicalizeReticulumDestinationHash(
      typeof o.destination_hash === 'string' ? o.destination_hash : '',
    );
    const filePath = typeof o.path === 'string' ? o.path : '';
    if (!destinationHash) {
      return { ok: false, error: 'invalid_destination_hash' };
    }
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
    reticulumProxyIpcRateLimit.checkOrThrow();
    if (!opts || typeof opts !== 'object') {
      throw new TypeError('rncpFetch: opts must be an object');
    }
    const o = opts as Record<string, unknown>;
    const destinationHash = canonicalizeReticulumDestinationHash(
      typeof o.destination_hash === 'string' ? o.destination_hash : '',
    );
    const remotePath = typeof o.remote_path === 'string' ? o.remote_path : '';
    const savePath =
      typeof o.save_path === 'string' && o.save_path.trim() ? o.save_path : undefined;
    if (!destinationHash) {
      return { ok: false, error: 'invalid_destination_hash' };
    }
    if (remotePath.length === 0 || remotePath.length > 1024 || remotePath.includes('\0')) {
      return { ok: false, error: 'invalid_remote_path' };
    }
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
   * Picker-gated rncp listener config: when enabling, `save_dir` is required and
   * must fall under the last {@link showRncpSaveDirectoryDialog} result.
   * `fetch_jail` is required whenever `allow_fetch` is true (remote peers may
   * otherwise read arbitrary absolute paths) and is gated the same way.
   */
  ipcMain.handle('reticulum:setRncpListener', async (event, opts: unknown) => {
    assertIpcSender(event, 'reticulum:setRncpListener');
    reticulumProxyIpcRateLimit.checkOrThrow();
    if (!opts || typeof opts !== 'object') {
      throw new TypeError('setRncpListener: opts must be an object');
    }
    const o = opts as Record<string, unknown>;
    const enabled = o.enabled === true;
    const allowFetch = o.allow_fetch === true;
    const saveDir = typeof o.save_dir === 'string' && o.save_dir.trim() ? o.save_dir : undefined;
    const fetchJail =
      typeof o.fetch_jail === 'string' && o.fetch_jail.trim() ? o.fetch_jail : undefined;
    const dirError = validateRncpListenerDirs({ enabled, allowFetch, saveDir, fetchJail });
    if (dirError) return { ok: false, error: dirError };
    const allowed = Array.isArray(o.allowed)
      ? o.allowed.filter((v): v is string => typeof v === 'string')
      : [];
    const blocked = Array.isArray(o.blocked)
      ? o.blocked.filter((v): v is string => typeof v === 'string')
      : [];
    try {
      const m = ensureManager();
      return await m.proxyPost('/api/v1/rncp/listener', {
        enabled,
        save_dir: saveDir,
        allow_fetch: allowFetch,
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
  manager.on('voiceAudio', (evt) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('reticulum:voiceAudio', evt);
  });
  manager.on('status', (status) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('reticulum:status', status);
  });
}
