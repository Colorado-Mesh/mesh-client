import { BrowserWindow, dialog } from 'electron';
import fs from 'fs';
import path from 'path';

import type {
  ReticulumIdentityBackupImportDialogResult,
  ReticulumIdentityExportSaveResult,
  ReticulumIdentityImportDialogResult,
} from '../shared/electron-api.types';
import { RETICULUM_CONFIG_MAX_READ_BYTES } from '../shared/reticulumProxyLimits';
import { readUtf8FileBounded } from './reticulum-config-read';

export const RNS_PRIVATE_KEY_LEN = 64;

/** Max decoded bytes for identity export writes (.rsi JSON or raw 64-byte key). */
export const RETICULUM_IDENTITY_EXPORT_MAX_BYTES = 256 * 1024;

function dialogParent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined;
}

export async function showReticulumIdentityImportDialog(): Promise<ReticulumIdentityImportDialogResult> {
  const parent = dialogParent();
  const result = parent
    ? await dialog.showOpenDialog(parent, {
        properties: ['openFile'],
        filters: [
          {
            name: 'Reticulum identity',
            extensions: ['retid', 'key', 'identity', 'rid', '*'],
          },
        ],
      })
    : await dialog.showOpenDialog({
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

/** Open a Ratspeak `.rsi` / JSON identity backup (UTF-8 text, size-capped). */
export async function showReticulumIdentityBackupImportDialog(): Promise<ReticulumIdentityBackupImportDialogResult> {
  const parent = dialogParent();
  const result = parent
    ? await dialog.showOpenDialog(parent, {
        properties: ['openFile'],
        filters: [
          {
            name: 'Ratspeak identity backup',
            extensions: ['rsi', 'json'],
          },
        ],
      })
    : await dialog.showOpenDialog({
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
    const contentText = readUtf8FileBounded(filePath, RETICULUM_CONFIG_MAX_READ_BYTES);
    return { path: filePath, contentText, error: null };
  } catch (err) {
    // catch-no-log-ok: dialog file read failed; caller shows error state
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('byte limit')) {
      return { path: filePath, contentText: null, error: 'too_large' };
    }
    return { path: filePath, contentText: null, error: 'read_failed' };
  }
}

function validateExportOpts(opts: unknown):
  | {
      defaultPath: string;
      contentBase64: string;
    }
  | { error: NonNullable<ReticulumIdentityExportSaveResult['error']> } {
  if (opts == null || typeof opts !== 'object' || Array.isArray(opts)) {
    return { error: 'invalid_opts' };
  }
  const record = opts as Record<string, unknown>;
  if (typeof record.defaultPath !== 'string' || typeof record.contentBase64 !== 'string') {
    return { error: 'invalid_opts' };
  }
  if (
    !record.contentBase64 ||
    record.contentBase64.length > RETICULUM_IDENTITY_EXPORT_MAX_BYTES * 2
  ) {
    return { error: 'content_too_large' };
  }
  // basename only — never allow path traversal via defaultPath
  const defaultPath = path.basename(record.defaultPath.trim() || 'reticulum-identity.export');
  if (!defaultPath || defaultPath === '.' || defaultPath === '..') {
    return { error: 'invalid_opts' };
  }
  return { defaultPath, contentBase64: record.contentBase64 };
}

/** Save exported identity bytes (raw 64-byte or UTF-8 `.rsi` JSON as base64). */
export async function saveReticulumIdentityExportDialog(
  opts: unknown,
): Promise<ReticulumIdentityExportSaveResult> {
  const validated = validateExportOpts(opts);
  if ('error' in validated) {
    return { path: null, error: validated.error };
  }
  let data: Buffer;
  try {
    data = Buffer.from(validated.contentBase64, 'base64');
  } catch {
    // catch-no-log-ok: invalid base64 returned to UI
    return { path: null, error: 'invalid_opts' };
  }
  if (data.length === 0 || data.length > RETICULUM_IDENTITY_EXPORT_MAX_BYTES) {
    return { path: null, error: 'content_too_large' };
  }
  const parent = dialogParent();
  const result = parent
    ? await dialog.showSaveDialog(parent, { defaultPath: validated.defaultPath })
    : await dialog.showSaveDialog({ defaultPath: validated.defaultPath });
  if (result.canceled || !result.filePath) {
    return { path: null, error: null };
  }
  try {
    fs.writeFileSync(result.filePath, data, { mode: 0o600 });
    try {
      fs.chmodSync(result.filePath, 0o600);
    } catch {
      // catch-no-log-ok: chmod best-effort on platforms that ignore mode
    }
    return { path: result.filePath, error: null };
  } catch {
    // catch-no-log-ok: save failure returned to UI
    return { path: null, error: 'write_failed' };
  }
}
