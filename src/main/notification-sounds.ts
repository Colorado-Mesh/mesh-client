import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  isNotificationSoundEvent,
  MAX_NOTIFICATION_SOUND_BYTES,
  type NotificationSoundImport,
  type NotificationSoundRecord,
} from '../shared/notificationSounds';

const execFileAsync = promisify(execFile);
const MAX_RECORD_BYTES = 2 * Math.ceil(MAX_NOTIFICATION_SOUND_BYTES / 3) * 4 + 2048;

export async function readBoundedSoundFile(filePath: string, limit: number): Promise<Buffer> {
  const handle = await open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > limit) {
      throw new Error('Sound must be a nonempty file under 2 MiB');
    }
    const bytes = Buffer.alloc(limit + 1);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > limit) throw new Error('Sound file exceeds size limit');
    return bytes.subarray(0, total);
  } finally {
    await handle.close();
  }
}

function isAiff(bytes: Buffer): boolean {
  return (
    bytes.toString('ascii', 0, 4) === 'FORM' &&
    ['AIFF', 'AIFC'].includes(bytes.toString('ascii', 8, 12))
  );
}

function assertAudio(bytes: Buffer): void {
  const signature = bytes.toString('ascii', 0, 4);
  if (
    (signature === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') ||
    signature === 'OggS' ||
    signature === 'fLaC' ||
    bytes.toString('ascii', 0, 3) === 'ID3' ||
    (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) ||
    bytes.toString('ascii', 4, 8) === 'ftyp'
  )
    return;
  throw new Error('Unsupported audio file');
}

/** Only called with a path returned by the native file chooser. */
export async function importNotificationSound(filePath: string): Promise<NotificationSoundImport> {
  let bytes = await readBoundedSoundFile(filePath, MAX_NOTIFICATION_SOUND_BYTES);
  if (isAiff(bytes) && process.platform === 'darwin') {
    // OS-specific: convert macOS's installed AIFF alerts to portable WAV.
    const directory = await mkdtemp(path.join(tmpdir(), 'mesh-notification-sound-'));
    try {
      const input = path.join(directory, 'input.aiff');
      const output = path.join(directory, 'output.wav');
      await writeFile(input, bytes, { mode: 0o600 });
      await execFileAsync('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16', input, output], {
        timeout: 10_000,
        maxBuffer: 64 * 1024,
      });
      bytes = await readBoundedSoundFile(output, MAX_NOTIFICATION_SOUND_BYTES);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  assertAudio(bytes);
  return { name: path.basename(filePath).slice(0, 120), dataBase64: bytes.toString('base64') };
}

function parseSound(value: unknown): NotificationSoundImport {
  if (!value || typeof value !== 'object') throw new Error('Invalid sound');
  const sound = value as Record<string, unknown>;
  if (
    typeof sound.name !== 'string' ||
    sound.name.length === 0 ||
    sound.name.length > 120 ||
    // eslint-disable-next-line no-control-regex -- Display labels must not contain control characters.
    /[\x00-\x1f\x7f]/.test(sound.name) ||
    typeof sound.dataBase64 !== 'string' ||
    sound.dataBase64.length === 0 ||
    sound.dataBase64.length > Math.ceil(MAX_NOTIFICATION_SOUND_BYTES / 3) * 4
  )
    throw new Error('Invalid sound');
  const bytes = Buffer.from(sound.dataBase64, 'base64');
  if (
    bytes.length > MAX_NOTIFICATION_SOUND_BYTES ||
    bytes.toString('base64') !== sound.dataBase64
  ) {
    throw new Error('Invalid sound data');
  }
  assertAudio(bytes);
  return { name: sound.name, dataBase64: sound.dataBase64 };
}

function soundId(sound: NotificationSoundImport): string {
  return createHash('sha256').update(Buffer.from(sound.dataBase64, 'base64')).digest('hex');
}

async function readSoundRecords(
  directory: string,
  event: string,
): Promise<NotificationSoundImport[]> {
  let bytes: Buffer;
  try {
    bytes = await readBoundedSoundFile(path.join(directory, `${event}.json`), MAX_RECORD_BYTES);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  try {
    const records: unknown = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(records) || records.length > 2) throw new Error('Invalid saved sounds');
    return records.map(parseSound);
  } catch {
    console.warn(
      '[notificationSounds] Invalid saved recording; using the original tone until replaced',
    );
    return [];
  }
}

export async function saveNotificationSound(
  directory: string,
  event: unknown,
  value: unknown,
  previousId?: unknown,
): Promise<NotificationSoundRecord> {
  if (!isNotificationSoundEvent(event)) throw new Error('Invalid sound event');
  if (
    previousId !== undefined &&
    (typeof previousId !== 'string' || !/^[a-f0-9]{64}$/.test(previousId))
  ) {
    throw new Error('Invalid previous sound reference');
  }
  const sound = parseSound(value);
  const id = soundId(sound);
  const existing = await readSoundRecords(directory, event);
  const previous = existing.find(
    (record) => soundId(record) === previousId && soundId(record) !== id,
  );
  // Keep the selected sound until its replacement preference is committed to SQLite.
  const records = previous ? [sound, previous] : [sound];
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, `${event}.json`);
  const temporary = path.join(directory, `${event}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(records), { mode: 0o600, flag: 'wx' });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  return { id, name: sound.name };
}

export async function readNotificationSound(
  directory: string,
  event: unknown,
  id: unknown,
): Promise<string | null> {
  if (!isNotificationSoundEvent(event) || typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) {
    throw new Error('Invalid sound reference');
  }
  const records = await readSoundRecords(directory, event);
  return records.find((record) => soundId(record) === id)?.dataBase64 ?? null;
}
