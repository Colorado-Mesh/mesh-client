import { dialog } from 'electron';
import fs from 'fs';

import type {
  ReticulumIdentityExportSaveResult,
  ReticulumIdentityImportDialogResult,
} from '../shared/electron-api.types';

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

/** Open a Ratspeak `.rsi` / JSON identity backup (UTF-8 text). */
export async function showReticulumIdentityBackupImportDialog(): Promise<{
  path: string | null;
  contentText: string | null;
  error: 'read_failed' | null;
}> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      {
        name: 'Ratspeak identity backup',
        extensions: ['rsi', 'json'],
      },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { path: null, contentText: null, error: null };
  }
  const filePath = result.filePaths[0];
  try {
    const contentText = fs.readFileSync(filePath, 'utf8');
    return { path: filePath, contentText, error: null };
  } catch {
    // catch-no-log-ok: dialog file read failed; caller shows error state
    return { path: filePath, contentText: null, error: 'read_failed' };
  }
}

/** Save exported identity bytes (raw 64-byte or UTF-8 `.rsi` JSON as base64). */
export async function saveReticulumIdentityExportDialog(opts: {
  defaultPath: string;
  contentBase64: string;
}): Promise<ReticulumIdentityExportSaveResult> {
  const result = await dialog.showSaveDialog({
    defaultPath: opts.defaultPath,
  });
  if (result.canceled || !result.filePath) {
    return { path: null, error: null };
  }
  try {
    const data = Buffer.from(opts.contentBase64, 'base64');
    fs.writeFileSync(result.filePath, data);
    return { path: result.filePath, error: null };
  } catch {
    // catch-no-log-ok: save failure returned to UI
    return { path: null, error: 'write_failed' };
  }
}
