import { dialog } from 'electron';
import fs from 'fs';

import type { ReticulumIdentityImportDialogResult } from '../shared/electron-api.types';

export const RNS_PRIVATE_KEY_LEN = 64;

export async function showReticulumIdentityImportDialog(): Promise<ReticulumIdentityImportDialogResult> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      {
        name: 'Reticulum identity',
        extensions: ['retid', 'key', 'identity', 'rid', '*'],
      },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { path: null, contentBase64: null, byteLength: null, error: null };
  }
  const filePath = result.filePaths[0];
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const stat = fs.fstatSync(fd);
      if (stat.size !== RNS_PRIVATE_KEY_LEN) {
        return {
          path: filePath,
          contentBase64: null,
          byteLength: stat.size,
          error: 'invalid_private_key_length',
        };
      }
      const data = Buffer.alloc(RNS_PRIVATE_KEY_LEN);
      const bytesRead = fs.readSync(fd, data, 0, RNS_PRIVATE_KEY_LEN, 0);
      if (bytesRead !== RNS_PRIVATE_KEY_LEN) {
        return {
          path: filePath,
          contentBase64: null,
          byteLength: bytesRead,
          error: 'invalid_private_key_length',
        };
      }
      return {
        path: filePath,
        contentBase64: data.toString('base64'),
        byteLength: data.length,
        error: null,
      };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // catch-no-log-ok: dialog file read failed; caller shows error state
    return {
      path: filePath,
      contentBase64: null,
      byteLength: null,
      error: 'read_failed',
    };
  }
}
