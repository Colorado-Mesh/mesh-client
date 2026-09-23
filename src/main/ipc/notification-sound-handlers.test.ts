import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => '/profile') },
  BrowserWindow: { fromWebContents: vi.fn(() => ({})) },
  dialog: { showOpenDialog: vi.fn() },
}));
vi.mock('node:fs', () => ({ existsSync: vi.fn(() => true) }));
vi.mock('../notification-sounds', () => ({
  importNotificationSound: vi.fn(),
  saveNotificationSound: vi.fn(),
  readNotificationSound: vi.fn(),
}));
vi.mock('../validate-ipc-sender', () => ({ assertIpcSender: vi.fn() }));

import { dialog, ipcMain, type OpenDialogOptions } from 'electron';

import {
  importNotificationSound,
  readNotificationSound,
  saveNotificationSound,
} from '../notification-sounds';
import { assertIpcSender } from '../validate-ipc-sender';
import { registerNotificationSoundHandlers } from './notification-sound-handlers';

describe('notification sound IPC', () => {
  const event = { sender: {} };
  function handler(channel: string) {
    const call = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel);
    if (!call) throw new Error(`Missing ${channel}`);
    return call[1] as (event: unknown, ...args: unknown[]) => Promise<unknown>;
  }
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertIpcSender).mockImplementation(() => {});
    registerNotificationSoundHandlers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['darwin', 'win32', 'linux'])(
    'uses the native audio chooser on %s and preserves cancellation',
    async (platform) => {
      vi.stubGlobal('process', { ...process, platform });
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] });
      expect(await handler('notificationSounds:choose')(event)).toBeNull();
      expect(importNotificationSound).not.toHaveBeenCalled();
      const options = (
        vi.mocked(dialog.showOpenDialog).mock.calls[0] as unknown[]
      )[1] as OpenDialogOptions;
      expect(options).toMatchObject({ properties: ['openFile'] });
      expect(options?.filters?.[0]?.extensions).toEqual([
        'wav',
        'mp3',
        'ogg',
        'flac',
        ...(platform === 'linux' ? [] : ['m4a', 'aac']),
        ...(platform === 'darwin' ? ['aiff', 'aif'] : []),
      ]);
      expect(assertIpcSender).toHaveBeenCalledWith(event, 'notificationSounds:choose');
    },
  );

  it('imports only a path returned by the native dialog and forwards save/read references', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/chosen.wav'],
    });
    const sound = { name: 'chosen.wav', dataBase64: 'bytes' };
    vi.mocked(importNotificationSound).mockResolvedValueOnce(sound);
    expect(await handler('notificationSounds:choose')(event, '/untrusted')).toBe(sound);
    expect(importNotificationSound).toHaveBeenCalledWith('/chosen.wav');
    await handler('notificationSounds:save')(event, 'dm', sound, 'old');
    expect(saveNotificationSound).toHaveBeenCalledWith(
      expect.stringContaining('notification-sounds'),
      'dm',
      sound,
      'old',
    );
    await handler('notificationSounds:read')(event, 'dm', 'id');
    expect(readNotificationSound).toHaveBeenCalledWith(
      expect.stringContaining('notification-sounds'),
      'dm',
      'id',
    );
  });

  it.each(['choose', 'save', 'read'])('rejects untrusted senders before %s I/O', async (method) => {
    vi.mocked(assertIpcSender).mockImplementationOnce(() => {
      throw new Error('sender rejected');
    });
    await expect(handler(`notificationSounds:${method}`)(event, 'dm', 'data')).rejects.toThrow(
      'sender rejected',
    );
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    expect(saveNotificationSound).not.toHaveBeenCalled();
    expect(readNotificationSound).not.toHaveBeenCalled();
  });

  it('does not stack dialogs and releases the lock after a cancelled selection', async () => {
    let complete!: (value: { canceled: boolean; filePaths: string[] }) => void;
    vi.mocked(dialog.showOpenDialog).mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const first = handler('notificationSounds:choose')(event);
    await expect(handler('notificationSounds:choose')(event)).rejects.toThrow('already open');
    complete({ canceled: true, filePaths: [] });
    await first;
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await handler('notificationSounds:choose')(event)).toBeNull();
  });
});
