import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RETICULUM_IDENTITY_EXPORT_MAX_BYTES,
  RNS_PRIVATE_KEY_LEN,
  saveReticulumIdentityExportDialog,
  showReticulumIdentityBackupImportDialog,
  showReticulumIdentityImportDialog,
} from './reticulum-identity-import';

const {
  showOpenDialogMock,
  showSaveDialogMock,
  openSyncMock,
  fstatSyncMock,
  readSyncMock,
  closeSyncMock,
  writeFileSyncMock,
  chmodSyncMock,
  getFocusedWindowMock,
  getAllWindowsMock,
  writeSyncMock,
  fsyncSyncMock,
  renameSyncMock,
  unlinkSyncMock,
} = vi.hoisted(() => ({
  showOpenDialogMock: vi.fn(),
  showSaveDialogMock: vi.fn(),
  openSyncMock: vi.fn(),
  fstatSyncMock: vi.fn(),
  readSyncMock: vi.fn(),
  closeSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  chmodSyncMock: vi.fn(),
  getFocusedWindowMock: vi.fn(),
  getAllWindowsMock: vi.fn(),
  writeSyncMock: vi.fn(),
  fsyncSyncMock: vi.fn(),
  renameSyncMock: vi.fn(),
  unlinkSyncMock: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: getFocusedWindowMock,
    getAllWindows: getAllWindowsMock,
  },
  dialog: {
    showOpenDialog: showOpenDialogMock,
    showSaveDialog: showSaveDialogMock,
  },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('fs');
  return {
    default: {
      ...actual,
      openSync: openSyncMock,
      fstatSync: fstatSyncMock,
      readSync: readSyncMock,
      closeSync: closeSyncMock,
      writeFileSync: writeFileSyncMock,
      chmodSync: chmodSyncMock,
      writeSync: writeSyncMock,
      fsyncSync: fsyncSyncMock,
      renameSync: renameSyncMock,
      unlinkSync: unlinkSyncMock,
      constants: actual.constants,
    },
  };
});

vi.mock('./reticulum-config-read', () => ({
  readUtf8FileBounded: vi.fn(),
}));

import { readUtf8FileBounded } from './reticulum-config-read';

const readUtf8FileBoundedMock = vi.mocked(readUtf8FileBounded);

interface ActualFs {
  openSync: (...args: unknown[]) => number;
  writeSync: (...args: unknown[]) => number;
  fsyncSync: (...args: unknown[]) => void;
  closeSync: (...args: unknown[]) => void;
  chmodSync: (...args: unknown[]) => void;
  unlinkSync: (...args: unknown[]) => void;
  mkdtempSync: (prefix: string) => string;
  existsSync: (p: string) => boolean;
  readdirSync: (p: string) => string[];
  rmSync: (p: string, opts: { recursive: boolean; force: boolean }) => void;
}

describe('showReticulumIdentityImportDialog', () => {
  beforeEach(() => {
    showOpenDialogMock.mockReset();
    openSyncMock.mockReset();
    fstatSyncMock.mockReset();
    readSyncMock.mockReset();
    closeSyncMock.mockReset();
    getFocusedWindowMock.mockReturnValue(null);
    getAllWindowsMock.mockReturnValue([]);
    openSyncMock.mockReturnValue(3);
  });

  it('returns null content when dialog is canceled', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] });
    await expect(showReticulumIdentityImportDialog()).resolves.toEqual({
      path: null,
      contentBase64: null,
      byteLength: null,
      error: null,
    });
  });

  it('rejects files that are not exactly 64 bytes', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/tmp/key.retid'] });
    fstatSyncMock.mockReturnValue({ size: 32 });
    await expect(showReticulumIdentityImportDialog()).resolves.toEqual({
      path: '/tmp/key.retid',
      contentBase64: null,
      byteLength: 32,
      error: 'invalid_private_key_length',
    });
    expect(closeSyncMock).toHaveBeenCalledWith(3);
  });

  it('returns base64 for a valid 64-byte identity file', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/tmp/key.retid'] });
    const bytes = Buffer.alloc(RNS_PRIVATE_KEY_LEN, 0xab);
    fstatSyncMock.mockReturnValue({ size: RNS_PRIVATE_KEY_LEN });
    readSyncMock.mockImplementation((_fd: number, buf: Buffer, _offset: number, length: number) => {
      bytes.copy(buf, 0, 0, length);
      return length;
    });
    const result = await showReticulumIdentityImportDialog();
    expect(result.error).toBeNull();
    expect(result.byteLength).toBe(RNS_PRIVATE_KEY_LEN);
    expect(result.contentBase64).toBe(bytes.toString('base64'));
    expect(closeSyncMock).toHaveBeenCalledWith(3);
  });
});

describe('showReticulumIdentityBackupImportDialog', () => {
  beforeEach(() => {
    showOpenDialogMock.mockReset();
    readUtf8FileBoundedMock.mockReset();
    getFocusedWindowMock.mockReturnValue(null);
    getAllWindowsMock.mockReturnValue([]);
  });

  it('reads .rsi text content via bounded reader', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/tmp/id.rsi'] });
    readUtf8FileBoundedMock.mockReturnValue('{"format":"ratspeak.identity.v2"}');
    await expect(showReticulumIdentityBackupImportDialog()).resolves.toEqual({
      path: '/tmp/id.rsi',
      contentText: '{"format":"ratspeak.identity.v2"}',
      error: null,
    });
    expect(showOpenDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [expect.objectContaining({ extensions: ['rsi', 'json'] })],
      }),
    );
    expect(readUtf8FileBoundedMock).toHaveBeenCalledWith('/tmp/id.rsi', expect.any(Number));
  });

  it('maps oversized backups to too_large', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/tmp/big.rsi'] });
    readUtf8FileBoundedMock.mockImplementation(() => {
      throw new Error('config file exceeds 2097152 byte limit');
    });
    await expect(showReticulumIdentityBackupImportDialog()).resolves.toEqual({
      path: '/tmp/big.rsi',
      contentText: null,
      error: 'too_large',
    });
  });
});

describe('saveReticulumIdentityExportDialog', () => {
  beforeEach(() => {
    showSaveDialogMock.mockReset();
    openSyncMock.mockReset();
    writeSyncMock.mockReset();
    fsyncSyncMock.mockReset();
    closeSyncMock.mockReset();
    chmodSyncMock.mockReset();
    renameSyncMock.mockReset();
    unlinkSyncMock.mockReset();
    getFocusedWindowMock.mockReturnValue(null);
    getAllWindowsMock.mockReturnValue([]);
    openSyncMock.mockReturnValue(7);
  });

  it('rejects invalid opts without opening the dialog', async () => {
    await expect(saveReticulumIdentityExportDialog(null)).resolves.toEqual({
      path: null,
      error: 'invalid_opts',
    });
    expect(showSaveDialogMock).not.toHaveBeenCalled();
  });

  it('uses basename-only defaultPath and writes via exclusive temp + rename', async () => {
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/tmp/out.identity' });
    const bytes = Buffer.alloc(RNS_PRIVATE_KEY_LEN, 0x11);
    await expect(
      saveReticulumIdentityExportDialog({
        defaultPath: '../../evil/x.identity',
        contentBase64: bytes.toString('base64'),
      }),
    ).resolves.toEqual({ path: '/tmp/out.identity', error: null });
    expect(showSaveDialogMock).toHaveBeenCalledWith({ defaultPath: 'x.identity' });
    // Temp name is based on the chosen save path basename, not defaultPath.
    expect(openSyncMock.mock.calls[0][0]).toMatch(/\/tmp\/\.out\.identity\.\d+\.\d+\.tmp$/);
    expect(openSyncMock.mock.calls[0][2]).toBe(0o600);
    expect(writeSyncMock).toHaveBeenCalledWith(7, bytes);
    expect(fsyncSyncMock).toHaveBeenCalledWith(7);
    expect(chmodSyncMock).toHaveBeenCalledWith(expect.stringContaining('.tmp'), 0o600);
    expect(renameSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('.tmp'),
      '/tmp/out.identity',
    );
  });

  it('rejects decoded content over the export size cap', async () => {
    const oversized = Buffer.alloc(RETICULUM_IDENTITY_EXPORT_MAX_BYTES + 1, 1);
    await expect(
      saveReticulumIdentityExportDialog({
        defaultPath: 'x.rsi',
        contentBase64: oversized.toString('base64'),
      }),
    ).resolves.toEqual({ path: null, error: 'content_too_large' });
    expect(showSaveDialogMock).not.toHaveBeenCalled();
  });

  it('returns write_failed and removes temp when rename fails on a real temp dir', async () => {
    const actualFs: ActualFs = await vi.importActual('fs');
    openSyncMock.mockImplementation((...args: unknown[]) => actualFs.openSync(...args));
    writeSyncMock.mockImplementation((...args: unknown[]) => actualFs.writeSync(...args));
    fsyncSyncMock.mockImplementation((...args: unknown[]) => {
      actualFs.fsyncSync(...args);
    });
    closeSyncMock.mockImplementation((...args: unknown[]) => {
      actualFs.closeSync(...args);
    });
    chmodSyncMock.mockImplementation((...args: unknown[]) => {
      actualFs.chmodSync(...args);
    });
    unlinkSyncMock.mockImplementation((...args: unknown[]) => {
      actualFs.unlinkSync(...args);
    });
    renameSyncMock.mockImplementation(() => {
      throw new Error('rename failed');
    });

    const tmpDir = actualFs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-identity-export-'));
    try {
      const dest = path.join(tmpDir, 'out.identity');
      showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: dest });
      const bytes = Buffer.alloc(RNS_PRIVATE_KEY_LEN, 0x22);
      await expect(
        saveReticulumIdentityExportDialog({
          defaultPath: 'out.identity',
          contentBase64: bytes.toString('base64'),
        }),
      ).resolves.toEqual({ path: null, error: 'write_failed' });
      expect(actualFs.existsSync(dest)).toBe(false);
      expect(actualFs.readdirSync(tmpDir)).toEqual([]);
    } finally {
      actualFs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
