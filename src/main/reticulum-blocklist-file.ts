import { BrowserWindow, dialog } from 'electron';
import fs from 'fs';

import { parseBlockedContactsFile, serializeBlockedContacts } from '../shared/blockedContactsFile';
import { readFileUpTo } from './readFileUpTo';
import { sanitizeLogMessage } from './sanitize-log-message';

/** Max bytes read from a user-selected blocklist file (32 hex chars + newline per entry). */
export const BLOCKLIST_FILE_MAX_READ_BYTES = 2 * 1024 * 1024;

export interface BlocklistExportResult {
  path: string | null;
  error: string | null;
}

export interface BlocklistImportFileResult {
  /** Normalized hashes ready for `db:importBlockedContacts`; null when cancelled. */
  hashes: string[] | null;
  /** Entries rejected during parsing (malformed or duplicated). */
  skipped: number;
  error: string | null;
}

function dialogParent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined;
}

function defaultExportName(): string {
  return `mesh-client-blocklist-${new Date().toISOString().slice(0, 10)}.json`;
}

/** Save dialog + write of the serialized blocklist. */
export async function saveBlocklistToFile(
  hashes: readonly string[],
): Promise<BlocklistExportResult> {
  const parent = dialogParent();
  const options = {
    title: 'Export blocked contacts',
    defaultPath: defaultExportName(),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  };
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) {
    return { path: null, error: null };
  }
  try {
    await fs.promises.writeFile(result.filePath, serializeBlockedContacts(hashes), 'utf8');
    return { path: result.filePath, error: null };
  } catch {
    // catch-no-log-ok: write failure surfaced to the UI as a toast
    return { path: null, error: 'write_failed' };
  }
}

/** Open dialog + bounded read + pure parse. Does not touch the database. */
export async function readBlocklistFromFile(): Promise<BlocklistImportFileResult> {
  const parent = dialogParent();
  const options = {
    title: 'Import blocked contacts',
    filters: [
      { name: 'Blocklist', extensions: ['json', 'txt', 'csv'] },
      { name: 'All files', extensions: ['*'] },
    ],
    properties: ['openFile' as const],
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return { hashes: null, skipped: 0, error: null };
  }

  let raw: string;
  try {
    const buffer = await readFileUpTo(result.filePaths[0], BLOCKLIST_FILE_MAX_READ_BYTES);
    raw = buffer.toString('utf8');
  } catch (err) {
    const tooLarge = err instanceof Error && err.message === 'File too large';
    console.warn(
      '[ReticulumBlocklistFile] read failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    return { hashes: null, skipped: 0, error: tooLarge ? 'file_too_large' : 'read_failed' };
  }

  const parsed = parseBlockedContactsFile(raw);
  if (!parsed) {
    return { hashes: null, skipped: 0, error: 'parse_failed' };
  }
  return { hashes: parsed.hashes, skipped: parsed.skipped, error: null };
}
