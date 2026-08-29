// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { showOpenDialogMock, showSaveDialogMock } = vi.hoisted(() => ({
  showOpenDialogMock: vi.fn(),
  showSaveDialogMock: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showOpenDialog: showOpenDialogMock, showSaveDialog: showSaveDialogMock },
}));

import {
  BLOCKLIST_FILE_MAX_READ_BYTES,
  readBlocklistFromFile,
  saveBlocklistToFile,
} from './reticulum-blocklist-file';

const HASH_1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const HASH_2 = 'b1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('reticulum-blocklist-file', () => {
  let tempRoot: string;

  beforeEach(() => {
    showOpenDialogMock.mockReset();
    showSaveDialogMock.mockReset();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-blocklist-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('saveBlocklistToFile', () => {
    it('writes nothing when the dialog is cancelled', async () => {
      showSaveDialogMock.mockResolvedValue({ canceled: true, filePath: undefined });

      const result = await saveBlocklistToFile([HASH_1]);

      expect(result).toEqual({ path: null, error: null });
      expect(fs.readdirSync(tempRoot)).toEqual([]);
    });

    it('writes the serialized payload to the chosen path', async () => {
      const target = path.join(tempRoot, 'blocklist.json');
      showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: target });

      const result = await saveBlocklistToFile([HASH_1, HASH_2]);

      expect(result).toEqual({ path: target, error: null });
      const written = JSON.parse(fs.readFileSync(target, 'utf8')) as {
        version: number;
        blocked: string[];
      };
      expect(written.version).toBe(1);
      expect(written.blocked).toEqual([HASH_1, HASH_2]);
    });

    it('reports write_failed when the path is not writable', async () => {
      // A directory path cannot be written as a file.
      showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: tempRoot });

      const result = await saveBlocklistToFile([HASH_1]);

      expect(result).toEqual({ path: null, error: 'write_failed' });
    });

    it('offers a dated json default filename', async () => {
      showSaveDialogMock.mockResolvedValue({ canceled: true, filePath: undefined });

      await saveBlocklistToFile([]);

      const options = showSaveDialogMock.mock.calls[0]?.[0] as { defaultPath: string };
      expect(options.defaultPath).toMatch(/^mesh-client-blocklist-\d{4}-\d{2}-\d{2}\.json$/);
    });
  });

  describe('readBlocklistFromFile', () => {
    function pick(contents: string, name = 'in.json'): string {
      const file = path.join(tempRoot, name);
      fs.writeFileSync(file, contents, 'utf8');
      showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [file] });
      return file;
    }

    it('returns a null hash list when cancelled', async () => {
      showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] });

      expect(await readBlocklistFromFile()).toEqual({ hashes: null, skipped: 0, error: null });
    });

    it('returns a null hash list when no file is selected', async () => {
      showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [] });

      expect(await readBlocklistFromFile()).toEqual({ hashes: null, skipped: 0, error: null });
    });

    it('parses a JSON export payload', async () => {
      pick(JSON.stringify({ version: 1, blocked: [HASH_1, HASH_2] }));

      expect(await readBlocklistFromFile()).toEqual({
        hashes: [HASH_1, HASH_2],
        skipped: 0,
        error: null,
      });
    });

    it('parses newline-delimited text and reports skipped entries', async () => {
      pick(`${HASH_1}\nnot-a-hash\n${HASH_2}\n`, 'in.txt');

      expect(await readBlocklistFromFile()).toEqual({
        hashes: [HASH_1, HASH_2],
        skipped: 1,
        error: null,
      });
    });

    it('reports file_too_large past the read cap without parsing', async () => {
      pick('a'.repeat(BLOCKLIST_FILE_MAX_READ_BYTES + 1), 'big.txt');

      expect(await readBlocklistFromFile()).toEqual({
        hashes: null,
        skipped: 0,
        error: 'file_too_large',
      });
    });

    it('reports parse_failed for malformed JSON rather than importing zero entries', async () => {
      pick('{ "blocked": [');

      expect(await readBlocklistFromFile()).toEqual({
        hashes: null,
        skipped: 0,
        error: 'parse_failed',
      });
    });

    it('reports read_failed when the selected file disappears', async () => {
      const file = pick(JSON.stringify([HASH_1]));
      fs.rmSync(file);

      expect(await readBlocklistFromFile()).toEqual({
        hashes: null,
        skipped: 0,
        error: 'read_failed',
      });
    });

    it('returns an empty list for an empty file', async () => {
      pick('', 'empty.txt');

      expect(await readBlocklistFromFile()).toEqual({ hashes: [], skipped: 0, error: null });
    });
  });
});
