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

vi.mock('fs', () => ({
  default: {
    openSync: openSyncMock,
    fstatSync: fstatSyncMock,
    readSync: readSyncMock,
    closeSync: closeSyncMock,
    writeFileSync: writeFileSyncMock,
    chmodSync: chmodSyncMock,
  },
}));

vi.mock('./reticulum-config-read', () => ({
  readUtf8FileBounded: vi.fn(),
}));

import { readUtf8FileBounded } from './reticulum-config-read';

const readUtf8FileBoundedMock = vi.mocked(readUtf8FileBounded);

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
    writeFileSyncMock.mockReset();
    chmodSyncMock.mockReset();
    getFocusedWindowMock.mockReturnValue(null);
    getAllWindowsMock.mockReturnValue([]);
  });

  it('rejects invalid opts without opening the dialog', async () => {
    await expect(saveReticulumIdentityExportDialog(null)).resolves.toEqual({
      path: null,
      error: 'invalid_opts',
    });
    expect(showSaveDialogMock).not.toHaveBeenCalled();
  });

  it('uses basename-only defaultPath and writes mode 0o600', async () => {
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/tmp/out.identity' });
    const bytes = Buffer.alloc(RNS_PRIVATE_KEY_LEN, 0x11);
    await expect(
      saveReticulumIdentityExportDialog({
        defaultPath: '../../evil/x.identity',
        contentBase64: bytes.toString('base64'),
      }),
    ).resolves.toEqual({ path: '/tmp/out.identity', error: null });
    expect(showSaveDialogMock).toHaveBeenCalledWith({ defaultPath: 'x.identity' });
    expect(writeFileSyncMock).toHaveBeenCalledWith('/tmp/out.identity', bytes, { mode: 0o600 });
    expect(chmodSyncMock).toHaveBeenCalledWith('/tmp/out.identity', 0o600);
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
});
