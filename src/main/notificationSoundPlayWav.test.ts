import { type ChildProcess, execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type * as FsPromises from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_NOTIFICATION_SOUND_BYTES } from '../shared/notificationSounds';
import {
  playNotificationSoundWav,
  registerNotificationSoundPlayWavIpc,
  stopNotificationSoundWav,
} from './notificationSoundPlayWav';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<{
    execFile: typeof execFile;
  }>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

const wavWriteGate: { promise: Promise<void> } = { promise: Promise.resolve() };
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    writeFile: async (
      filePath: Parameters<typeof actual.writeFile>[0],
      data: Parameters<typeof actual.writeFile>[1],
      options?: Parameters<typeof actual.writeFile>[2],
    ) => {
      const pathText =
        typeof filePath === 'string' ? filePath : filePath instanceof URL ? filePath.pathname : '';
      if (pathText.includes('tone.wav')) {
        await wavWriteGate.promise;
      }
      return actual.writeFile(filePath, data, options);
    },
  };
});

function sound(marker = 'one') {
  return Buffer.from(`RIFF0000WAVE${marker}`).toString('base64');
}

function mockChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  let killed = false;
  Object.defineProperty(child, 'killed', {
    configurable: true,
    get: () => killed,
  });
  child.kill = vi.fn(() => {
    killed = true;
    queueMicrotask(() => {
      child.emit('close', null, 'SIGTERM');
    });
    return true;
  });
  return child;
}

describe('playNotificationSoundWav', () => {
  beforeEach(() => {
    vi.mocked(execFile).mockClear();
    wavWriteGate.promise = Promise.resolve();
    stopNotificationSoundWav();
  });
  afterEach(() => {
    stopNotificationSoundWav();
    vi.unstubAllGlobals();
    vi.mocked(execFile).mockReset();
  });

  it('rejects on non-Windows platforms', async () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' });
    await expect(playNotificationSoundWav(sound())).rejects.toThrow('only available');
    expect(execFile).not.toHaveBeenCalled();
  });

  it('rejects oversized or non-WAV payloads on Windows', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    await expect(playNotificationSoundWav('')).rejects.toThrow('Invalid sound data');
    await expect(
      playNotificationSoundWav(Buffer.from('not a wav').toString('base64')),
    ).rejects.toThrow('requires WAV');
    await expect(
      playNotificationSoundWav(Buffer.alloc(MAX_NOTIFICATION_SOUND_BYTES + 1).toString('base64')),
    ).rejects.toThrow('Invalid sound data');
    expect(execFile).not.toHaveBeenCalled();
  });

  it('writes a mkdtemp WAV and invokes SoundPlayer on Windows', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32', env: process.env });
    vi.mocked(execFile).mockImplementation(() => {
      const child = mockChild();
      queueMicrotask(() => {
        child.emit('close', 0, null);
      });
      return child;
    });
    const before = (await readdir(tmpdir())).filter((name) => name.startsWith('mesh-notif-sound-'));
    await playNotificationSoundWav(sound());
    expect(execFile).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining(['-NoProfile', '-NonInteractive', '-Command', expect.any(String)]),
      expect.objectContaining({
        windowsHide: true,
        env: expect.objectContaining({ MESH_NOTIF_WAV: expect.stringContaining('tone.wav') }),
      }),
    );
    expect(
      (await readdir(tmpdir())).filter((name) => name.startsWith('mesh-notif-sound-')),
    ).toEqual(before);
  });

  it('skips SoundPlayer when a newer request supersedes before execFile', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32', env: process.env });
    let releaseFirstWrite!: () => void;
    wavWriteGate.promise = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    vi.mocked(execFile).mockImplementation(() => {
      const child = mockChild();
      queueMicrotask(() => {
        child.emit('close', 0, null);
      });
      return child;
    });
    const first = playNotificationSoundWav(sound('one'));
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
    const second = playNotificationSoundWav(sound('two'));
    releaseFirstWrite();
    wavWriteGate.promise = Promise.resolve();
    await first;
    await second;
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it('stops the prior SoundPlayer child when a new tone starts', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32', env: process.env });
    const children: ChildProcess[] = [];
    vi.mocked(execFile).mockImplementation(() => {
      const child = mockChild();
      children.push(child);
      if (children.length === 1) return child;
      queueMicrotask(() => {
        child.emit('close', 0, null);
      });
      return child;
    });
    const first = playNotificationSoundWav(sound('one'));
    await vi.waitFor(() => {
      expect(children).toHaveLength(1);
    });
    const second = playNotificationSoundWav(sound('two'));
    expect(children[0]?.kill).toHaveBeenCalled();
    await first;
    await second;
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it('stopNotificationSoundWav kills an in-flight SoundPlayer child', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32', env: process.env });
    const child = mockChild();
    vi.mocked(execFile).mockImplementation(() => child);
    const playing = playNotificationSoundWav(sound());
    await vi.waitFor(() => {
      expect(execFile).toHaveBeenCalled();
    });
    stopNotificationSoundWav();
    expect(child.kill).toHaveBeenCalled();
    await playing;
  });

  it('registers playWav and stopWav IPC handlers', () => {
    const handle = vi.fn();
    const assertIpcSender = vi.fn();
    registerNotificationSoundPlayWavIpc({
      ipcMain: { handle },
      assertIpcSender,
    });
    expect(handle).toHaveBeenCalledWith('notificationSounds:playWav', expect.any(Function));
    expect(handle).toHaveBeenCalledWith('notificationSounds:stopWav', expect.any(Function));
  });
});
