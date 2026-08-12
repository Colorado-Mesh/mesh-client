import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
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
  readFileSyncMock,
  writeFileSyncMock,
} = vi.hoisted(() => ({
  showOpenDialogMock: vi.fn(),
  showSaveDialogMock: vi.fn(),
  openSyncMock: vi.fn(),
  fstatSyncMock: vi.fn(),
  readSyncMock: vi.fn(),
  closeSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
}));

vi.mock('electron', () => ({
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
    readFileSync: readFileSyncMock,
    writeFileSync: writeFileSyncMock,
  },
}));

describe('showReticulumIdentityImportDialog', () => {
  beforeEach(() => {
    showOpenDialogMock.mockReset();
    openSyncMock.mockReset();
    fstatSyncMock.mockReset();
    readSyncMock.mockReset();
    closeSyncMock.mockReset();
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
    readFileSyncMock.mockReset();
  });

  it('reads .rsi text content', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/tmp/id.rsi'] });
    readFileSyncMock.mockReturnValue('{"format":"ratspeak.identity.v2"}');
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
  });
});

describe('saveReticulumIdentityExportDialog', () => {
  beforeEach(() => {
    showSaveDialogMock.mockReset();
    writeFileSyncMock.mockReset();
  });

  it('writes base64 content to the chosen path', async () => {
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/tmp/out.identity' });
    const bytes = Buffer.alloc(RNS_PRIVATE_KEY_LEN, 0x11);
    await expect(
      saveReticulumIdentityExportDialog({
        defaultPath: 'x.identity',
        contentBase64: bytes.toString('base64'),
      }),
    ).resolves.toEqual({ path: '/tmp/out.identity', error: null });
    expect(writeFileSyncMock).toHaveBeenCalledWith('/tmp/out.identity', bytes);
  });
});
