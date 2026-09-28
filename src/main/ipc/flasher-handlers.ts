import fs from 'node:fs';
import path from 'node:path';

import { app, BrowserWindow, dialog, ipcMain } from 'electron';

import {
  FIRMWARE_BACKUP_MAX_BYTES,
  type FirmwareBackupSaveResult,
} from '../../shared/firmwareBackup';
import { MS_PER_MINUTE } from '../../shared/timeConstants';
import { createIpcRateLimiter } from '../ipcRateLimit';
import { sanitizeLogMessage } from '../sanitize-log-message';
import { assertIpcSender } from '../validate-ipc-sender';

const SAFE_FILENAME_RE = /^[A-Za-z0-9._-]{1,128}\.bin$/;

/**
 * RNode ESP32 firmware backup: the renderer reads flash over Web Serial and hands the bytes
 * here for a native save dialog. Failure point: `writeFile` — a partial file may remain at the
 * chosen path; the error is logged and rethrown so the renderer reports the failure.
 */
export function registerFlasherHandlers(): void {
  const saves = createIpcRateLimiter({
    max: 5,
    windowMs: MS_PER_MINUTE,
    label: 'flasher:saveFirmwareBackup',
  });
  let saving = false;

  ipcMain.handle(
    'flasher:saveFirmwareBackup',
    async (event, filename: unknown, data: unknown): Promise<FirmwareBackupSaveResult> => {
      assertIpcSender(event, 'flasher:saveFirmwareBackup');
      if (typeof filename !== 'string' || !SAFE_FILENAME_RE.test(filename)) {
        throw new Error('flasher:saveFirmwareBackup: invalid filename');
      }
      if (
        !(data instanceof Uint8Array) ||
        data.length === 0 ||
        data.length > FIRMWARE_BACKUP_MAX_BYTES
      ) {
        throw new Error('flasher:saveFirmwareBackup: data must be a non-empty Uint8Array ≤ 32 MiB');
      }
      saves.checkOrThrow();
      if (saving) throw new Error('flasher:saveFirmwareBackup: save dialog already open');
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return { saved: false };
      saving = true;
      try {
        const result = await dialog.showSaveDialog(window, {
          title: 'Save firmware backup',
          defaultPath: path.join(app.getPath('downloads'), filename),
          filters: [{ name: 'Firmware image', extensions: ['bin'] }],
        });
        if (result.canceled || !result.filePath) return { saved: false };
        await fs.promises.writeFile(result.filePath, data);
        return { saved: true, path: result.filePath };
      } catch (err) {
        console.error(
          '[IPC] flasher:saveFirmwareBackup failed:',
          sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
        );
        throw err;
      } finally {
        saving = false;
      }
    },
  );
}
