import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { IpcMain, IpcMainInvokeEvent } from 'electron';

import { MAX_NOTIFICATION_SOUND_BYTES } from '../shared/notificationSounds';
import { MS_PER_MINUTE } from '../shared/timeConstants';
import { createIpcRateLimiter } from './ipcRateLimit';

const execFileAsync = promisify(execFile);
const MAX_BASE64_SOUND_CHARS = Math.ceil(MAX_NOTIFICATION_SOUND_BYTES / 3) * 4;

/**
 * OS-specific (#1487): play a PCM WAV through Windows System.Media.SoundPlayer so
 * notification tones work when Chromium Web Audio never opens a WASAPI session.
 *
 * Built as sibling `notification-sound-play-wav.js` so it stays out of the measured
 * main `index.js` budget.
 */
export async function playNotificationSoundWav(dataBase64: unknown): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('Native notification playback is only available on Windows');
  }
  if (
    typeof dataBase64 !== 'string' ||
    dataBase64.length === 0 ||
    dataBase64.length > MAX_BASE64_SOUND_CHARS
  ) {
    throw new Error('Invalid sound data');
  }
  const bytes = Buffer.from(dataBase64, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_NOTIFICATION_SOUND_BYTES) {
    throw new Error('Invalid sound data');
  }
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Native playback requires WAV audio');
  }
  const timeoutMs = Math.min(
    30_000,
    Math.max(5_000, Math.ceil((bytes.length / 8000) * 1000) + 5_000),
  );
  const directory = await mkdtemp(path.join(tmpdir(), 'mesh-notif-sound-'));
  const wavPath = path.join(directory, 'tone.wav');
  try {
    await writeFile(wavPath, bytes, { mode: 0o600 });
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$ErrorActionPreference = 'Stop'; $p = New-Object System.Media.SoundPlayer -ArgumentList $env:MESH_NOTIF_WAV; $p.PlaySync()",
      ],
      {
        timeout: timeoutMs,
        windowsHide: true,
        env: { ...process.env, MESH_NOTIF_WAV: wavPath },
        maxBuffer: 64 * 1024,
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export interface NotificationSoundPlayWavIpcDeps {
  ipcMain: Pick<IpcMain, 'handle'>;
  assertIpcSender: (event: IpcMainInvokeEvent, channel: string) => void;
}

/** Register playWav IPC in the sibling chunk (out of measured index.js). */
export function registerNotificationSoundPlayWavIpc(deps: NotificationSoundPlayWavIpcDeps): void {
  const plays = createIpcRateLimiter({
    max: 60,
    windowMs: MS_PER_MINUTE,
    label: 'notificationSounds:playWav',
  });
  deps.ipcMain.handle('notificationSounds:playWav', async (event, dataBase64: unknown) => {
    deps.assertIpcSender(event, 'notificationSounds:playWav');
    plays.checkOrThrow();
    await playNotificationSoundWav(dataBase64);
  });
}
