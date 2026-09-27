import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => '/downloads') },
  BrowserWindow: { fromWebContents: vi.fn(() => ({})) },
  dialog: { showSaveDialog: vi.fn() },
}));
vi.mock('node:fs', () => ({ default: { promises: { writeFile: vi.fn() } } }));
vi.mock('../validate-ipc-sender', () => ({ assertIpcSender: vi.fn() }));

import fs from 'node:fs';

import { dialog, ipcMain } from 'electron';

import { FIRMWARE_BACKUP_MAX_BYTES } from '../../shared/firmwareBackup';
import { assertIpcSender } from '../validate-ipc-sender';
import { registerFlasherHandlers } from './flasher-handlers';

describe('flasher:saveFirmwareBackup IPC', () => {
  const event = { sender: {} };
  const name = 'rnode-backup-esp32-s3-20260927-120000.bin';
  function handler() {
    const call = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'flasher:saveFirmwareBackup');
    if (!call) throw new Error('Missing flasher:saveFirmwareBackup');
    return call[1] as (event: unknown, ...args: unknown[]) => Promise<unknown>;
  }
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertIpcSender).mockImplementation(() => {});
    registerFlasherHandlers();
  });

  it('writes the bytes to the path chosen in the native save dialog', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: false,
      filePath: '/chosen/backup.bin',
    });
    const data = new Uint8Array([1, 2, 3]);
    expect(await handler()(event, name, data)).toEqual({
      saved: true,
      path: '/chosen/backup.bin',
    });
    expect((vi.mocked(dialog.showSaveDialog).mock.calls[0] as unknown[])[1]).toMatchObject({
      defaultPath: expect.stringContaining(name),
    });
    expect(fs.promises.writeFile).toHaveBeenCalledWith('/chosen/backup.bin', data);
  });

  it('returns saved:false on cancel without writing', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath: '' });
    expect(await handler()(event, name, new Uint8Array([1]))).toEqual({ saved: false });
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
  });

  it.each([
    ['path traversal', '../evil.bin', new Uint8Array([1])],
    ['wrong extension', 'backup.exe', new Uint8Array([1])],
    ['non-string name', 42, new Uint8Array([1])],
    ['empty data', name, new Uint8Array()],
    ['non-bytes data', name, 'AAAA'],
    ['oversized data', name, new Uint8Array(FIRMWARE_BACKUP_MAX_BYTES + 1)],
  ])('rejects %s before opening a dialog', async (_label, filename, data) => {
    await expect(handler()(event, filename, data)).rejects.toThrow();
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
  });

  it('rejects untrusted senders before any I/O', async () => {
    vi.mocked(assertIpcSender).mockImplementationOnce(() => {
      throw new Error('sender rejected');
    });
    await expect(handler()(event, name, new Uint8Array([1]))).rejects.toThrow('sender rejected');
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
  });

  it('logs and rethrows write failures', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: false,
      filePath: '/chosen/backup.bin',
    });
    vi.mocked(fs.promises.writeFile).mockRejectedValueOnce(new Error('disk full'));
    await expect(handler()(event, name, new Uint8Array([1]))).rejects.toThrow('disk full');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
