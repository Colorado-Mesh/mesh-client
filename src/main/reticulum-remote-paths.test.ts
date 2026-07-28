// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  let tempRoot: string;

  beforeEach(() => {
    showOpenDialogMock.mockReset();
    clearRncpPickerAllowlist();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-rncp-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('showRncpOpenFileDialog remembers the picked file and allows only that exact path', async () => {
    const filePath = path.join(tempRoot, 'bar.txt');
    fs.writeFileSync(filePath, 'x');
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [filePath] });
    const result = await showRncpOpenFileDialog();
    expect(result.canceled).toBe(false);
    expect(result.path).toBe(fs.realpathSync.native(filePath));
    expect(isAllowedRncpSendFilePath(filePath)).toBe(true);
    expect(isAllowedRncpSendFilePath(path.join(tempRoot, 'other.txt'))).toBe(false);
    expect(isAllowedRncpSendFilePath('/etc/passwd')).toBe(false);
  });

  it('showRncpOpenFileDialog cancellation does not authorize any path', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] });
    const result = await showRncpOpenFileDialog();
    expect(result).toEqual({ canceled: true, path: null });
    expect(isAllowedRncpSendFilePath(path.join(tempRoot, 'bar.txt'))).toBe(false);
  });

  it('showRncpSaveDirectoryDialog allows the exact directory and nested paths under it', async () => {
    const saveDir = path.join(tempRoot, 'rncp-save');
    fs.mkdirSync(saveDir);
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [saveDir] });
    await showRncpSaveDirectoryDialog();
    expect(isAllowedRncpSaveDirectoryPath(saveDir)).toBe(true);
    expect(isAllowedRncpSaveDirectoryPath(path.join(saveDir, 'received.bin'))).toBe(true);
    expect(isAllowedRncpSaveDirectoryPath(`${saveDir}-evil`)).toBe(false);
    expect(isAllowedRncpSaveDirectoryPath(path.join(tempRoot, 'other'))).toBe(false);
  });

  it('rejects symlink escape outside the picked directory', async () => {
    const saveDir = path.join(tempRoot, 'rncp-save');
    const outside = path.join(tempRoot, 'outside');
    fs.mkdirSync(saveDir);
    fs.mkdirSync(outside);
    const secret = path.join(outside, 'secret.txt');
    fs.writeFileSync(secret, 'nope');
    const link = path.join(saveDir, 'escape');
    fs.symlinkSync(secret, link);
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [saveDir] });
    await showRncpSaveDirectoryDialog();
    expect(isAllowedRncpSaveDirectoryPath(link)).toBe(false);
  });

  it('keeps both save_dir and fetch_jail authorized after two distinct directory picks', async () => {
    const inbox = path.join(tempRoot, 'rncp-inbox');
    const jail = path.join(tempRoot, 'rncp-jail');
    fs.mkdirSync(inbox);
    fs.mkdirSync(jail);
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [inbox] });
    await showRncpSaveDirectoryDialog();
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [jail] });
    await showRncpSaveDirectoryDialog();

    expect(isAllowedRncpSaveDirectoryPath(inbox)).toBe(true);
    expect(isAllowedRncpSaveDirectoryPath(path.join(inbox, 'file.bin'))).toBe(true);
    expect(isAllowedRncpSaveDirectoryPath(jail)).toBe(true);
    expect(isAllowedRncpSaveDirectoryPath(path.join(jail, 'read.bin'))).toBe(true);
    expect(isAllowedRncpSaveDirectoryPath(path.join(tempRoot, 'unrelated'))).toBe(false);
  });

  it('rejects null/empty candidates and unset pickers', () => {
    expect(isAllowedRncpSendFilePath(null)).toBe(false);
    expect(isAllowedRncpSendFilePath('')).toBe(false);
    expect(isAllowedRncpSaveDirectoryPath(undefined)).toBe(false);
  });

  it('isAllowedRncpRevealPath accepts either picker allowlist', async () => {
    const sendFile = path.join(tempRoot, 'send.txt');
    const recvDir = path.join(tempRoot, 'recv');
    fs.writeFileSync(sendFile, 'x');
    fs.mkdirSync(recvDir);
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [sendFile] });
    await showRncpOpenFileDialog();
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [recvDir] });
    await showRncpSaveDirectoryDialog();

    expect(isAllowedRncpRevealPath(sendFile)).toBe(true);
    expect(isAllowedRncpRevealPath(path.join(recvDir, 'inbound.bin'))).toBe(true);
    expect(isAllowedRncpRevealPath(path.join(tempRoot, 'unrelated'))).toBe(false);
  });

  it('isRncpPickerGatedApiPath matches send/fetch/listener', () => {
    expect(isRncpPickerGatedApiPath('/api/v1/rncp/send')).toBe(true);
    expect(isRncpPickerGatedApiPath('/api/v1/rncp/fetch')).toBe(true);
    expect(isRncpPickerGatedApiPath('/api/v1/rncp/listener')).toBe(true);
    expect(isRncpPickerGatedApiPath('/api/v1/rncp/status')).toBe(false);
  });
});
