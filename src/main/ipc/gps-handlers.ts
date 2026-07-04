import { ipcMain } from 'electron';

import { getGpsFix } from '../gps';
import { sanitizeLogMessage } from '../log-service';
import { assertIpcSender } from '../validate-ipc-sender';

/** Register GPS IPC handlers (`gps:*`). */
export function registerGpsIpcHandlers(): void {
  ipcMain.handle('gps:getFix', async (event) => {
    assertIpcSender(event, 'gps:getFix');
    try {
      return await getGpsFix();
    } catch (err) {
      console.error(
        '[gps] getGpsFix threw:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      return {
        status: 'error',
        message: 'Location unavailable (network or service error).',
        code: 'UNKNOWN',
      };
    }
  });
}
