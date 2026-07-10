import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RNS_PRIVATE_KEY_LEN,
  showReticulumIdentityImportDialog,
} from './reticulum-identity-import';

const { showOpenDialogMock, readFileSyncMock } = vi.hoisted(() => ({
  showOpenDialogMock: vi.fn(),
  readFileSyncMock: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: showOpenDialogMock,
  },
}));

vi.mock('fs', () => ({
  default: {
    readFileSync: readFileSyncMock,
  },
}));

describe('showReticulumIdentityImportDialog', () => {
  beforeEach(() => {
    showOpenDialogMock.mockReset();
    readFileSyncMock.mockReset();
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
    readFileSyncMock.mockReturnValue(Buffer.alloc(32));
    await expect(showReticulumIdentityImportDialog()).resolves.toEqual({
      path: '/tmp/key.retid',
      contentBase64: null,
      byteLength: 32,
      error: 'invalid_private_key_length',
    });
  });

  it('returns base64 for a valid 64-byte identity file', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/tmp/key.retid'] });
    const bytes = Buffer.alloc(RNS_PRIVATE_KEY_LEN, 0xab);
    readFileSyncMock.mockReturnValue(bytes);
    const result = await showReticulumIdentityImportDialog();
    expect(result.error).toBeNull();
    expect(result.byteLength).toBe(RNS_PRIVATE_KEY_LEN);
    expect(result.contentBase64).toBe(bytes.toString('base64'));
  });
});
