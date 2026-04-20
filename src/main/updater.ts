import type { BrowserWindow } from 'electron';
import { app, ipcMain, shell } from 'electron';

import { sanitizeLogMessage } from './log-service';

// electron-updater is a runtime dependency only in the packaged app path
// We do a dynamic require so the dev path still works without it installed

let autoUpdater: any = null;
let checkNow: (() => void) | null = null;

/** Last release page URL from a GitHub API check (used when download cannot use electron-updater). */
let lastGithubReleaseUrl: string | null = null;

/** Returns the current update-check function (set after initUpdater runs). Used by native menu. */
export function getCheckNow(): (() => void) | null {
  return checkNow;
}

const REPO = 'Colorado-Mesh/mesh-client';
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

function semverGt(remote: string, local: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const [rMaj, rMin, rPat] = parse(remote);
  const [lMaj, lMin, lPat] = parse(local);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPat > lPat;
}

type SendFn = (channel: string, payload?: unknown) => void;

/**
 * GitHub Releases API check — used in dev, and as a fallback when packaged but
 * electron-updater is missing or failed to load (so IPC handlers still register).
 */
function registerGithubReleaseApiHandlers(send: SendFn, uiReportsPackaged: boolean): void {
  const doCheck = async () => {
    lastGithubReleaseUrl = null;
    try {
      const res = await fetch(API_URL, {
        headers: { 'User-Agent': `mesh-client/${app.getVersion()}` },
      });
      if (!res.ok) {
        console.warn('[updater] GitHub API responded with', String(res.status));
        send('update:error', { message: 'Update check failed — check network connection' });
        return;
      }
      if (res.redirected) {
        console.warn('[updater] GitHub API redirected to', res.url, '— API_URL may need updating');
      }
      const data = (await res.json()) as { tag_name: string; html_url: string };
      const remoteVersion = data.tag_name.replace(/^v/, '');
      const localVersion = app.getVersion();
      if (semverGt(remoteVersion, localVersion)) {
        lastGithubReleaseUrl = data.html_url;
        send('update:available', {
          version: remoteVersion,
          releaseUrl: data.html_url,
          isPackaged: uiReportsPackaged,
          isMac: process.platform === 'darwin',
        });
      } else {
        send('update:not-available');
      }
    } catch (e: unknown) {
      console.warn(
        '[updater] GitHub API fetch failed:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      send('update:error', { message: 'Update check failed — check network connection' });
    }
  };
  checkNow = () => {
    void doCheck();
  };

  ipcMain.handle('update:check', doCheck);

  ipcMain.handle('update:download', async () => {
    if (!uiReportsPackaged) return;
    if (process.platform === 'darwin') return;
    try {
      await shell.openExternal(lastGithubReleaseUrl ?? RELEASES_URL);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[updater] update:download (GitHub fallback) failed:', sanitizeLogMessage(msg));
      send('update:error', { message: msg });
    }
  });

  ipcMain.handle('update:install', () => {
    /* no-op — no downloaded artifact in this path */
  });
}

function registerElectronUpdaterHandlers(send: SendFn): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.error(
      '[updater] electron-updater not available:',
      sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );
    return false;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info: { version: string }) => {
    send('update:available', {
      version: info.version,
      releaseUrl: `${RELEASES_URL}/tag/v${info.version}`,
      isPackaged: true,
      isMac: process.platform === 'darwin',
    });
  });

  autoUpdater.on('update-not-available', () => {
    send('update:not-available');
  });

  autoUpdater.on('download-progress', (progress: { percent: number }) => {
    send('update:progress', { percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', () => {
    send('update:downloaded');
  });

  autoUpdater.on('error', (err: Error) => {
    console.error('[updater] error:', sanitizeLogMessage(err.message));
    send('update:error', { message: err.message });
  });

  const doCheck = async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[updater] checkForUpdates failed:', sanitizeLogMessage(msg));
      send('update:error', { message: msg });
    }
  };
  checkNow = () => {
    void doCheck();
  };

  ipcMain.handle('update:check', doCheck);

  ipcMain.handle('update:download', async () => {
    if (process.platform === 'darwin') return;
    try {
      await autoUpdater.downloadUpdate();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[updater] update:download failed:', sanitizeLogMessage(msg));
      send('update:error', { message: msg });
    }
  });

  ipcMain.handle('update:install', () => {
    if (process.platform === 'darwin') return;
    autoUpdater.quitAndInstall(false, true);
  });

  return true;
}

export function initUpdater(win: BrowserWindow): void {
  const send = (channel: string, payload?: unknown) => {
    if (win.isDestroyed()) return;
    win.webContents.send(channel, payload);
  };

  if (app.isPackaged) {
    const ok = registerElectronUpdaterHandlers(send);
    if (!ok) {
      console.warn('[updater] falling back to GitHub Releases API (packaged build)');
      registerGithubReleaseApiHandlers(send, true);
    }
  } else {
    registerGithubReleaseApiHandlers(send, false);
  }

  ipcMain.handle('update:open-releases', async (_event, url?: string) => {
    try {
      console.debug('[IPC] update:open-releases');
      let parsedUrl: URL | null = null;
      try {
        if (typeof url === 'string') parsedUrl = new URL(url);
      } catch {
        // catch-no-log-ok — invalid URL falls through to RELEASES_URL
      }
      const target =
        parsedUrl?.hostname === 'github.com' && parsedUrl.protocol === 'https:'
          ? url!
          : RELEASES_URL;
      await shell.openExternal(target);
    } catch (err) {
      console.error(
        '[IPC] update:open-releases failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  });
}
