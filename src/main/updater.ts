import type { BrowserWindow } from 'electron';
import { app, ipcMain, shell } from 'electron';

// electron-updater is a runtime dependency only in the packaged app path
// We do a dynamic require so the dev path still works without it installed

let autoUpdater: any = null;

const REPO = 'Colorado-Mesh/meshtastic-client';
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

export function initUpdater(win: BrowserWindow): void {
  const send = (channel: string, payload?: unknown) => {
    if (win.isDestroyed()) return;
    win.webContents.send(channel, payload);
  };

  if (app.isPackaged) {
    // ── Packaged path: electron-updater ─────────────────────────────
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      autoUpdater = require('electron-updater').autoUpdater;
    } catch (e) {
      console.error('[updater] electron-updater not available:', e);
      return;
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
      console.error('[updater] error:', err.message);
      send('update:error', { message: err.message });
    });

    // Delay the initial check so the window has time to fully mount
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((e: Error) => {
        console.error('[updater] checkForUpdates failed:', e.message);
      });
    }, 5000);

    ipcMain.handle('update:check', async () => {
      try {
        await autoUpdater.checkForUpdates();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[updater] update:check failed:', e);
        send('update:error', { message: msg });
      }
    });

    ipcMain.handle('update:download', async () => {
      if (process.platform === 'darwin') return; // macOS: open releases page instead
      try {
        await autoUpdater.downloadUpdate();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[updater] update:download failed:', e);
        send('update:error', { message: msg });
      }
    });

    ipcMain.handle('update:install', () => {
      if (process.platform === 'darwin') return;
      autoUpdater.quitAndInstall(false, true);
    });
  } else {
    // ── Dev / git-clone path: GitHub Releases API ────────────────────
    setTimeout(async () => {
      try {
        const res = await fetch(API_URL, {
          headers: { 'User-Agent': `mesh-client/${app.getVersion()}` },
        });
        if (!res.ok) {
          console.warn('[updater] GitHub API responded with', res.status);
          return;
        }
        const data = (await res.json()) as { tag_name: string; html_url: string };
        const remoteVersion = data.tag_name.replace(/^v/, '');
        const localVersion = app.getVersion();
        if (semverGt(remoteVersion, localVersion)) {
          send('update:available', {
            version: remoteVersion,
            releaseUrl: data.html_url,
            isPackaged: false,
            isMac: process.platform === 'darwin',
          });
        } else {
          send('update:not-available');
        }
      } catch (e) {
        // Network unreachable — silently skip, don't crash or show error
        console.warn('[updater] GitHub API fetch failed:', e);
      }
    }, 5000);

    // In dev mode, download/install are no-ops; just expose the handlers
    ipcMain.handle('update:check', async () => {
      try {
        const res = await fetch(API_URL, {
          headers: { 'User-Agent': `mesh-client/${app.getVersion()}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { tag_name: string; html_url: string };
        const remoteVersion = data.tag_name.replace(/^v/, '');
        const localVersion = app.getVersion();
        if (semverGt(remoteVersion, localVersion)) {
          send('update:available', {
            version: remoteVersion,
            releaseUrl: data.html_url,
            isPackaged: false,
            isMac: process.platform === 'darwin',
          });
        } else {
          send('update:not-available');
        }
      } catch (e) {
        console.warn('[updater] manual check failed:', e);
        send('update:error', { message: 'Update check failed — check network connection' });
      }
    });

    ipcMain.handle('update:download', () => {
      /* no-op in dev */
    });
    ipcMain.handle('update:install', () => {
      /* no-op in dev */
    });
  }

  // Shared: open the GitHub releases page
  ipcMain.handle('update:open-releases', async (_event, url?: string) => {
    try {
      console.debug('[IPC] update:open-releases');
      const target =
        typeof url === 'string' && url.startsWith('https://github.com/') ? url : RELEASES_URL;
      await shell.openExternal(target);
    } catch (err) {
      console.error('[IPC] update:open-releases failed:', err);
      throw err;
    }
  });
}
