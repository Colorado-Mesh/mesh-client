// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { showOpenDialogMock } = vi.hoisted(() => ({
  showOpenDialogMock: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: { showOpenDialog: showOpenDialogMock },
}));

import {
  clearRncpPickerAllowlist,
  isAllowedRncpRevealPath,
  isAllowedRncpSaveDirectoryPath,
  isAllowedRncpSendFilePath,
  isRncpPickerGatedApiPath,
  showRncpOpenFileDialog,
  showRncpSaveDirectoryDialog,
} from './reticulum-remote-paths';

describe('reticulum-remote-paths picker allowlist', () => {
  beforeEach(() => {
    showOpenDialogMock.mockReset();
    clearRncpPickerAllowlist();
  });

  it('showRncpOpenFileDialog remembers the picked file and allows only that exact path', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/tmp/foo/bar.txt'] });
    const result = await showRncpOpenFileDialog();
    expect(result).toEqual({ canceled: false, path: '/tmp/foo/bar.txt' });
    expect(isAllowedRncpSendFilePath('/tmp/foo/bar.txt')).toBe(true);
    expect(isAllowedRncpSendFilePath('/tmp/foo/other.txt')).toBe(false);
    expect(isAllowedRncpSendFilePath('/etc/passwd')).toBe(false);
  });

  it('showRncpOpenFileDialog cancellation does not authorize any path', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] });
    const result = await showRncpOpenFileDialog();
    expect(result).toEqual({ canceled: true, path: null });
    expect(isAllowedRncpSendFilePath('/tmp/foo/bar.txt')).toBe(false);
  });

  it('showRncpSaveDirectoryDialog allows the exact directory and nested paths under it', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/tmp/rncp-save'] });
    await showRncpSaveDirectoryDialog();
    expect(isAllowedRncpSaveDirectoryPath('/tmp/rncp-save')).toBe(true);
    expect(isAllowedRncpSaveDirectoryPath('/tmp/rncp-save/received.bin')).toBe(true);
    expect(isAllowedRncpSaveDirectoryPath('/tmp/rncp-save-evil')).toBe(false);
    expect(isAllowedRncpSaveDirectoryPath('/tmp/other')).toBe(false);
  });

  it('rejects null/empty candidates and unset pickers', () => {
    expect(isAllowedRncpSendFilePath(null)).toBe(false);
    expect(isAllowedRncpSendFilePath('')).toBe(false);
    expect(isAllowedRncpSaveDirectoryPath(undefined)).toBe(false);
  });

  it('isAllowedRncpRevealPath accepts either picker allowlist', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/tmp/send.txt'] });
    await showRncpOpenFileDialog();
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/tmp/recv'] });
    await showRncpSaveDirectoryDialog();

    expect(isAllowedRncpRevealPath('/tmp/send.txt')).toBe(true);
    expect(isAllowedRncpRevealPath('/tmp/recv/inbound.bin')).toBe(true);
    expect(isAllowedRncpRevealPath('/tmp/unrelated')).toBe(false);
  });

  it('clearRncpPickerAllowlist revokes previously picked paths', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/tmp/send.txt'] });
    await showRncpOpenFileDialog();
    expect(isAllowedRncpSendFilePath('/tmp/send.txt')).toBe(true);
    clearRncpPickerAllowlist();
    expect(isAllowedRncpSendFilePath('/tmp/send.txt')).toBe(false);
  });

  it('isRncpPickerGatedApiPath matches rncp send/fetch/listener mutation paths', () => {
    expect(isRncpPickerGatedApiPath('/api/v1/rncp/send')).toBe(true);
    expect(isRncpPickerGatedApiPath('/api/v1/rncp/fetch')).toBe(true);
    expect(isRncpPickerGatedApiPath('/api/v1/rncp/listener')).toBe(true);
    expect(isRncpPickerGatedApiPath('/api/v1/rncp/listener?x=1')).toBe(true);
    expect(isRncpPickerGatedApiPath('/api/v1/rncp/listener/')).toBe(true);
    expect(isRncpPickerGatedApiPath('/api/v1/rncp/status')).toBe(false);
    expect(isRncpPickerGatedApiPath('/api/v1/rncp/cancel')).toBe(false);
    expect(isRncpPickerGatedApiPath('/api/v1/rnsh/connect')).toBe(false);
  });
});
