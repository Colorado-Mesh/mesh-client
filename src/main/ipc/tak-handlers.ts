import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';

import { isValidConnectHost } from '../../shared/connectHost';
import {
  TAK_NODE_UPDATE_BATCH_MAX,
  type TAKEnrollmentRequest,
  type TAKRemoteStatus,
  type TAKServerStatus,
  type TAKSettings,
} from '../../shared/tak-types';
import { TCP_PORT_MAX, TCP_PORT_MIN } from '../../shared/tcpPort';
import { MS_PER_MINUTE } from '../../shared/timeConstants';
import { createIpcRateLimiter } from '../ipcRateLimit';
import { sanitizeLogMessage } from '../log-service';
import { enrollTakClientCertificate } from '../tak/enrollment';
import { parseTakNodeUpdate } from '../tak/node-update';
import {
  clearTakRemoteCredentials,
  loadTakRemoteCredentials,
  parseTakCredentialFiles,
  saveTakRemoteCredentials,
  summarizeTakRemoteCredentials,
  TAK_CREDENTIAL_FILE_MAX_BYTES,
  TAK_CREDENTIAL_FILES_MAX,
  type TakCredentialFile,
} from '../tak/remote-credentials';
import {
  DEFAULT_TAK_REMOTE_PORT,
  loadTakRemoteSettings,
  validateTakRemoteSettings,
} from '../tak/remote-settings';
import type { TakServerManager } from '../tak-server-manager';
import { assertIpcSender } from '../validate-ipc-sender';

export interface TakIpcDeps {
  idleTakStatus: TAKServerStatus;
  ensureTakServerManager: () => Promise<TakServerManager>;
  getTakServerManager: () => TakServerManager | null;
  validateTakSettings: (settings: unknown) => asserts settings is TAKSettings;
}

const IDLE_TAK_REMOTE_STATUS: TAKRemoteStatus = {
  state: 'disconnected',
  host: '',
  port: DEFAULT_TAK_REMOTE_PORT,
};

/** Longest PKCS#12 / private key password accepted over IPC. */
const TAK_CREDENTIAL_PASSWORD_MAX_LEN = 1024;

function errorMessage(err: unknown): string {
  return sanitizeLogMessage(err instanceof Error ? err.message : String(err));
}

/**
 * Read one chosen file through a single handle, so the type and size checks apply to the bytes
 * actually read, and never read more than the credential size cap.
 */
async function readCredentialFile(filePath: string): Promise<TakCredentialFile> {
  const name = path.basename(filePath);
  const notAFile = () => new Error(`${name} is not a regular file`);
  let handle: fs.promises.FileHandle;
  try {
    // OS-specific: O_NONBLOCK stops open() from waiting for a writer when the pick is a FIFO
    // (POSIX); Windows has no such flag and cannot open a FIFO path this way.
    handle = await fs.promises.open(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0),
    );
  } catch (err) {
    // OS-specific: Windows refuses to open a directory; POSIX opens it and fstat rejects it below.
    if ((err as NodeJS.ErrnoException).code === 'EISDIR') throw notAFile();
    throw err;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw notAFile();
    const tooLarge = () => new Error(`${name} is too large to be a certificate file`);
    if (stat.size > TAK_CREDENTIAL_FILE_MAX_BYTES) throw tooLarge();
    // One byte past the cap detects a file that grew after the size check.
    const buffer = Buffer.alloc(TAK_CREDENTIAL_FILE_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > TAK_CREDENTIAL_FILE_MAX_BYTES) throw tooLarge();
    return { name: filePath, data: buffer.subarray(0, bytesRead) };
  } finally {
    await handle.close();
  }
}

/** Basic auth cannot carry a colon in the username; TAK usernames never contain one. */
const TAK_USERNAME_RE = /^[^:\p{Cc}]{1,256}$/u;

function validateTakEnrollmentRequest(request: unknown): asserts request is TAKEnrollmentRequest {
  if (!request || typeof request !== 'object') {
    throw new Error('tak:remoteEnroll: request must be an object');
  }
  const r = request as Record<string, unknown>;
  if (typeof r.host !== 'string' || !isValidConnectHost(r.host)) {
    throw new Error('tak:remoteEnroll: host must be a hostname or IP address');
  }
  if (
    typeof r.port !== 'number' ||
    !Number.isInteger(r.port) ||
    r.port < TCP_PORT_MIN ||
    r.port > TCP_PORT_MAX
  ) {
    throw new Error(`tak:remoteEnroll: port must be an integer ${TCP_PORT_MIN}-${TCP_PORT_MAX}`);
  }
  if (typeof r.username !== 'string' || !TAK_USERNAME_RE.test(r.username)) {
    throw new Error('tak:remoteEnroll: username is invalid');
  }
  if (
    typeof r.password !== 'string' ||
    r.password.length === 0 ||
    r.password.length > TAK_CREDENTIAL_PASSWORD_MAX_LEN
  ) {
    throw new Error('tak:remoteEnroll: password must be a non-empty string');
  }
  if (typeof r.verifyServer !== 'boolean') {
    throw new Error('tak:remoteEnroll: verifyServer must be boolean');
  }
}

async function readCredentialFiles(filePaths: string[]): Promise<TakCredentialFile[]> {
  if (filePaths.length > TAK_CREDENTIAL_FILES_MAX) {
    throw new Error(`Select at most ${TAK_CREDENTIAL_FILES_MAX} certificate files`);
  }
  return Promise.all(filePaths.map(readCredentialFile));
}

/** Register TAK server IPC handlers (`tak:*`). */
export function registerTakIpcHandlers(deps: TakIpcDeps): void {
  const { idleTakStatus, ensureTakServerManager, getTakServerManager } = deps;
  const validateTakSettings: (settings: unknown) => asserts settings is TAKSettings =
    deps.validateTakSettings;

  ipcMain.handle('tak:start', async (event, settings: unknown) => {
    assertIpcSender(event, 'tak:start');
    try {
      console.debug('[IPC] tak:start');
      validateTakSettings(settings);
      const m = await ensureTakServerManager();
      await m.start(settings);
    } catch (err) {
      console.error(
        '[IPC] tak:start failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  });

  ipcMain.handle('tak:stop', (event) => {
    assertIpcSender(event, 'tak:stop');
    console.debug('[IPC] tak:stop');
    getTakServerManager()?.stop();
  });

  ipcMain.handle('tak:getStatus', (event) => {
    assertIpcSender(event, 'tak:getStatus');
    return getTakServerManager()?.getStatus() ?? idleTakStatus;
  });

  ipcMain.handle('tak:getConnectedClients', (event) => {
    assertIpcSender(event, 'tak:getConnectedClients');
    return getTakServerManager()?.getConnectedClients() ?? [];
  });

  ipcMain.handle('tak:generateDataPackage', async (event) => {
    assertIpcSender(event, 'tak:generateDataPackage');
    try {
      console.debug('[IPC] tak:generateDataPackage');
      const m = await ensureTakServerManager();
      await m.generateDataPackage();
    } catch (err) {
      console.error(
        '[IPC] tak:generateDataPackage failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  });

  ipcMain.handle('tak:regenerateCertificates', async (event) => {
    assertIpcSender(event, 'tak:regenerateCertificates');
    try {
      console.debug('[IPC] tak:regenerateCertificates');
      const m = await ensureTakServerManager();
      await m.regenerateCertificates();
    } catch (err) {
      console.error(
        '[IPC] tak:regenerateCertificates failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  });

  ipcMain.handle('tak:pushNodeUpdates', (event, nodes: unknown) => {
    assertIpcSender(event, 'tak:pushNodeUpdates');
    if (!Array.isArray(nodes) || nodes.length > TAK_NODE_UPDATE_BATCH_MAX) {
      throw new Error(
        `tak:pushNodeUpdates: nodes must be an array of at most ${TAK_NODE_UPDATE_BATCH_MAX} updates`,
      );
    }
    // Nothing is listening until a sink starts, so do not load the TAK module just to drop these.
    const m = getTakServerManager();
    if (!m?.hasActiveSink()) return;
    let rejected = 0;
    for (const raw of nodes) {
      const update = parseTakNodeUpdate(raw);
      if (update) m.onNodeUpdate(update);
      else rejected++;
    }
    if (rejected > 0) {
      console.debug(`[IPC] tak:pushNodeUpdates: dropped ${rejected} invalid node update(s)`);
    }
  });

  // ─── Remote TAK server relay ─────────────────────────────────────

  ipcMain.handle('tak:remoteStart', async (event, settings: unknown) => {
    assertIpcSender(event, 'tak:remoteStart');
    try {
      console.debug('[IPC] tak:remoteStart');
      validateTakRemoteSettings(settings);
      const m = await ensureTakServerManager();
      m.startRemote(settings);
    } catch (err) {
      console.error('[IPC] tak:remoteStart failed:', errorMessage(err));
      throw err;
    }
  });

  ipcMain.handle('tak:remoteStop', (event) => {
    assertIpcSender(event, 'tak:remoteStop');
    console.debug('[IPC] tak:remoteStop');
    getTakServerManager()?.stopRemote();
  });

  ipcMain.handle('tak:remoteGetStatus', (event) => {
    assertIpcSender(event, 'tak:remoteGetStatus');
    return getTakServerManager()?.getRemoteStatus() ?? { ...IDLE_TAK_REMOTE_STATUS };
  });

  ipcMain.handle('tak:remoteGetSettings', (event) => {
    assertIpcSender(event, 'tak:remoteGetSettings');
    try {
      return loadTakRemoteSettings();
    } catch (err) {
      console.warn('[IPC] tak:remoteGetSettings: saved settings unreadable:', errorMessage(err));
      return null;
    }
  });

  ipcMain.handle('tak:remoteGetCredentials', (event) => {
    assertIpcSender(event, 'tak:remoteGetCredentials');
    try {
      return summarizeTakRemoteCredentials(loadTakRemoteCredentials());
    } catch (err) {
      console.error('[IPC] tak:remoteGetCredentials failed:', errorMessage(err));
      throw err;
    }
  });

  const credentialImports = createIpcRateLimiter({
    max: 20,
    windowMs: MS_PER_MINUTE,
    label: 'tak:remoteImportCredentials',
  });
  let choosingCredentials = false;
  ipcMain.handle('tak:remoteImportCredentials', async (event, password: unknown) => {
    assertIpcSender(event, 'tak:remoteImportCredentials');
    credentialImports.checkOrThrow();
    if (
      password !== undefined &&
      (typeof password !== 'string' || password.length > TAK_CREDENTIAL_PASSWORD_MAX_LEN)
    ) {
      throw new Error('tak:remoteImportCredentials: password must be a string');
    }
    if (choosingCredentials) throw new Error('Certificate chooser is already open');
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    choosingCredentials = true;
    try {
      const result = await dialog.showOpenDialog(window, {
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'TAK certificates', extensions: ['p12', 'pfx', 'pem', 'crt', 'cer', 'key'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const creds = parseTakCredentialFiles(
        await readCredentialFiles(result.filePaths),
        password ?? '',
      );
      saveTakRemoteCredentials(creds);
      // A running relay holds its credentials in memory; reconnect it with the new ones.
      getTakServerManager()?.restartRemote();
      console.debug(
        `[IPC] tak:remoteImportCredentials: imported${creds.ca ? ' CA' : ''}${creds.cert ? ' client certificate' : ''}`,
      );
      return summarizeTakRemoteCredentials(loadTakRemoteCredentials());
    } catch (err) {
      console.error('[IPC] tak:remoteImportCredentials failed:', errorMessage(err));
      throw err;
    } finally {
      choosingCredentials = false;
    }
  });

  const enrollments = createIpcRateLimiter({
    max: 10,
    windowMs: MS_PER_MINUTE,
    label: 'tak:remoteEnroll',
  });
  let enrolling = false;
  ipcMain.handle('tak:remoteEnroll', async (event, request: unknown) => {
    assertIpcSender(event, 'tak:remoteEnroll');
    enrollments.checkOrThrow();
    validateTakEnrollmentRequest(request);
    if (enrolling || choosingCredentials) {
      throw new Error('Wait for the current certificate import to finish');
    }
    enrolling = true;
    try {
      console.debug('[IPC] tak:remoteEnroll');
      const creds = await enrollTakClientCertificate({
        host: request.host.trim(),
        port: request.port,
        username: request.username,
        password: request.password,
        verifyServer: request.verifyServer,
        trustedCa: loadTakRemoteCredentials().ca,
      });
      saveTakRemoteCredentials(creds);
      getTakServerManager()?.restartRemote();
      return summarizeTakRemoteCredentials(loadTakRemoteCredentials());
    } catch (err) {
      console.error('[IPC] tak:remoteEnroll failed:', errorMessage(err));
      throw err;
    } finally {
      enrolling = false;
    }
  });

  ipcMain.handle('tak:remoteClearCredentials', (event) => {
    assertIpcSender(event, 'tak:remoteClearCredentials');
    console.debug('[IPC] tak:remoteClearCredentials');
    // An import still in its chooser would write its files after this clear finished.
    if (choosingCredentials || enrolling) {
      throw new Error('Wait for the certificate import to finish before removing certificates');
    }
    // A running relay holds the credentials in memory; stop it so it cannot reconnect with them.
    getTakServerManager()?.stopRemote();
    clearTakRemoteCredentials();
    return summarizeTakRemoteCredentials(loadTakRemoteCredentials());
  });
}
