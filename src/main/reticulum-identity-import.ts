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
    const data = fs.readFileSync(filePath);
    if (data.length !== RNS_PRIVATE_KEY_LEN) {
      return {
        path: filePath,
        contentBase64: null,
        byteLength: data.length,
        error: 'invalid_private_key_length',
      };
    }
    return {
      path: filePath,
      contentBase64: data.toString('base64'),
      byteLength: data.length,
      error: null,
    };
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
