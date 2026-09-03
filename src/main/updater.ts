import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { app, ipcMain, shell } from 'electron';
import type { AppUpdater } from 'electron-updater';

import { fetchAllGithubReleases } from '@/shared/fetchGithubReleases';
import {
  type GithubReleaseRow,
  pickLatestPublishedRelease,
  semverGt,
} from '@/shared/githubReleaseVersion';

import { sanitizeLogMessage } from './log-service';
import { assertIpcSender } from './validate-ipc-sender';

// electron-updater is a runtime dependency only in the packaged app path
// We do a dynamic require so the dev path still works without it installed

/** Silent periodic check (no renderer “checking” event). */
let checkNow: (() => void) | null = null;
/** App menu: emits `update:checking` with notify flag, then runs the same check as IPC. */
let checkFromMenu: (() => void) | null = null;

/** Last app release page URL (GitHub); set on update:available for download / macOS open-in-browser. */
let lastAppReleaseUrl: string | null = null;

/** Menu “Check for Updates…” — shows footer progress + optional OS notify when settled. */
export function getCheckNowFromMenu(): (() => void) | null {
  return checkFromMenu;
}

const REPO = 'Colorado-Mesh/mesh-client';
const RELEASES_URL = `https://github.com/${REPO}/releases`;

type SendFn = (channel: string, payload?: unknown) => void;

function releaseUrlForVersion(version: string): string {
  return `${RELEASES_URL}/tag/v${version}`;
}

async function fetchGithubReleases(): Promise<GithubReleaseRow[]> {
  return fetchAllGithubReleases(REPO, `mesh-client/${app.getVersion()}`);
}

async function openAppReleasePage(send: SendFn): Promise<void> {
  try {
    await shell.openExternal(lastAppReleaseUrl ?? RELEASES_URL);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const safe = sanitizeLogMessage(msg);
    console.warn('[updater] open release page failed:', safe);
    send('update:error', { message: safe });
  }
}

/**
 * GitHub Releases API check — used in dev, and as a fallback when packaged but
 * electron-updater is missing or failed to load (so IPC handlers still register).
 */
function registerGithubReleaseApiHandlers(send: SendFn, uiReportsPackaged: boolean): void {
  const doCheck = async () => {
    lastAppReleaseUrl = null;
    try {
      const releases = await fetchGithubReleases();
      const latest = pickLatestPublishedRelease(releases);
      const localVersion = app.getVersion();
      if (latest && semverGt(latest.version, localVersion)) {
        lastAppReleaseUrl = latest.releaseUrl;
        send('update:available', {
          version: latest.version,
          releaseUrl: latest.releaseUrl,
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
  checkFromMenu = () => {
    send('update:checking', { notifyOnSettled: true });
    void doCheck();
  };

  ipcMain.handle('update:check', async (event: IpcMainInvokeEvent) => {
    assertIpcSender(event, 'update:check');
    send('update:checking', { notifyOnSettled: false });
    await doCheck();
  });

  ipcMain.handle('update:download', async (event: IpcMainInvokeEvent) => {
    assertIpcSender(event, 'update:download');
    if (!uiReportsPackaged) return;
    await openAppReleasePage(send);
  });

  ipcMain.handle('update:install', (event: IpcMainInvokeEvent) => {
    assertIpcSender(event, 'update:install');
    /* no-op — no downloaded artifact in this path */
  });
}

function registerElectronUpdaterHandlers(send: SendFn): boolean {
  let updater: AppUpdater;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    updater = (require('electron-updater') as { autoUpdater: AppUpdater }).autoUpdater;
  } catch (e) {
    console.error(
      '[updater] electron-updater not available:',
      sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );
    return false;
  }

  // Download in the background after every startup/periodic check. Installation
  // stays user-controlled so active radio sessions are never interrupted.
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;

  updater.on('update-available', (info: { version: string }) => {
    const releaseUrl = releaseUrlForVersion(info.version);
    lastAppReleaseUrl = releaseUrl;
    send('update:available', {
      version: info.version,
      releaseUrl,
      isPackaged: true,
      isMac: process.platform === 'darwin',
    });
    void (async () => {
      try {
        const releases = await fetchGithubReleases();
        const match = pickLatestPublishedRelease(releases);
        if (match?.version === info.version) {
          lastAppReleaseUrl = match.releaseUrl;
          send('update:available', {
            version: match.version,
            releaseUrl: match.releaseUrl,
            isPackaged: true,
            isMac: process.platform === 'darwin',
          });
        }
      } catch (e: unknown) {
        console.debug(
          '[updater] release URL enrichment skipped:',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      }
    })();
  });

  updater.on('update-not-available', () => {
    send('update:not-available');
  });

  updater.on('download-progress', (progress: { percent: number }) => {
    send('update:progress', { percent: Math.round(progress.percent) });
  });

  updater.on('update-downloaded', () => {
    send('update:downloaded');
  });

  updater.on('error', (err: Error) => {
    const safe = sanitizeLogMessage(err.message);
    console.error('[updater] error:', sanitizeLogMessage(err.message));
    send('update:error', { message: safe });
  });

  const doCheck = async () => {
    try {
      await updater.checkForUpdates();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const safe = sanitizeLogMessage(msg);
      console.warn('[updater] checkForUpdates failed:', safe);
      send('update:error', { message: safe });
    }
  };

  checkNow = () => {
    void doCheck();
  };
  checkFromMenu = () => {
    send('update:checking', { notifyOnSettled: true });
    void doCheck();
  };

  ipcMain.handle('update:check', async (event: IpcMainInvokeEvent) => {
    assertIpcSender(event, 'update:check');
    send('update:checking', { notifyOnSettled: false });
    await doCheck();
  });

  ipcMain.handle('update:download', async (event: IpcMainInvokeEvent) => {
    assertIpcSender(event, 'update:download');
    try {
      await updater.downloadUpdate();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const safe = sanitizeLogMessage(msg);
      console.warn('[updater] update:download failed:', safe);
      send('update:error', { message: safe });
    }
  });

  ipcMain.handle('update:install', (event: IpcMainInvokeEvent) => {
    assertIpcSender(event, 'update:install');
    updater.quitAndInstall(false, true);
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

  const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
  setInterval(() => checkNow?.(), CHECK_INTERVAL_MS).unref();

  ipcMain.handle('update:open-releases', async (event: IpcMainInvokeEvent, url?: string) => {
    assertIpcSender(event, 'update:open-releases');
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
