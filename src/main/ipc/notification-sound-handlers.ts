import { existsSync } from 'node:fs';
import path from 'node:path';

import { app, BrowserWindow, dialog, ipcMain } from 'electron';

import { MS_PER_MINUTE } from '../../shared/timeConstants';
import { createIpcRateLimiter } from '../ipcRateLimit';
import {
  importNotificationSound,
  readNotificationSound,
  saveNotificationSound,
} from '../notification-sounds';
import { assertIpcSender } from '../validate-ipc-sender';

export function registerNotificationSoundHandlers(): void {
  const imports = createIpcRateLimiter({
    max: 15,
    windowMs: MS_PER_MINUTE,
    label: 'notificationSounds:import',
  });
  const reads = createIpcRateLimiter({
    max: 60,
    windowMs: MS_PER_MINUTE,
    label: 'notificationSounds:read',
  });
  const directory = () => path.join(app.getPath('userData'), 'notification-sounds');
  let choosing = false;
  ipcMain.handle('notificationSounds:choose', async (event) => {
    assertIpcSender(event, 'notificationSounds:choose');
    imports.checkOrThrow();
    if (choosing) throw new Error('Sound chooser is already open');
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    choosing = true;
    try {
      // OS-specific: offer the installed sound directory without changing the system sound theme.
      const systemSounds =
        process.platform === 'darwin'
          ? '/System/Library/Sounds'
          : process.platform === 'win32'
            ? path.join(process.env.WINDIR ?? 'C:\\Windows', 'Media')
            : '/usr/share/sounds';
      const result = await dialog.showOpenDialog(window, {
        properties: ['openFile'],
        ...(existsSync(systemSounds) ? { defaultPath: systemSounds } : {}),
        filters: [
          {
            name: 'Audio',
            extensions: [
              'wav',
              'mp3',
              'ogg',
              'flac',
              'm4a',
              'aac',
              ...(process.platform === 'darwin' ? ['aiff', 'aif'] : []),
            ],
          },
        ],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return await importNotificationSound(result.filePaths[0]);
    } finally {
      choosing = false;
    }
  });
  ipcMain.handle(
    'notificationSounds:save',
    async (event, kind: unknown, sound: unknown, previousId: unknown) => {
      assertIpcSender(event, 'notificationSounds:save');
      imports.checkOrThrow();
      return saveNotificationSound(directory(), kind, sound, previousId);
    },
  );
  ipcMain.handle('notificationSounds:read', async (event, kind: unknown, id: unknown) => {
    assertIpcSender(event, 'notificationSounds:read');
    reads.checkOrThrow();
    return readNotificationSound(directory(), kind, id);
  });
}
