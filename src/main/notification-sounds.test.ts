import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_NOTIFICATION_SOUND_BYTES } from '../shared/notificationSounds';
import {
  importNotificationSound,
  readNotificationSound,
  saveNotificationSound,
} from './notification-sounds';

function sound(marker = 'one') {
  return {
    name: 'my tone.wav',
    dataBase64: Buffer.from(`RIFF0000WAVE${marker}`).toString('base64'),
  };
}

describe('notification sound files', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'mesh-sound-test-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('copies the selected audio, surviving removal of the original file', async () => {
    const source = path.join(directory, 'tone.wav');
    await writeFile(source, Buffer.from(sound().dataBase64, 'base64'));
    const imported = await importNotificationSound(source);
    const saved = await saveNotificationSound(directory, 'channel', imported);
    await rm(source);
    expect(await readNotificationSound(directory, 'channel', saved.id)).toBe(imported.dataBase64);
    expect(saved.name).toBe('tone.wav');
    expect(await readdir(directory)).toEqual(['channel.json']);
  });

  it('retains the selected recording across failed preference updates and further imports', async () => {
    const selected = await saveNotificationSound(directory, 'dm', sound('selected'));
    await saveNotificationSound(directory, 'dm', sound('not committed'), selected.id);
    const replacement = await saveNotificationSound(
      directory,
      'dm',
      sound('replacement'),
      selected.id,
    );
    expect(await readNotificationSound(directory, 'dm', selected.id)).toBe(
      sound('selected').dataBase64,
    );
    expect(await readNotificationSound(directory, 'dm', replacement.id)).toBe(
      sound('replacement').dataBase64,
    );
    expect(JSON.parse(await readFile(path.join(directory, 'dm.json'), 'utf8'))).toHaveLength(2);
  });

  it('keeps events isolated and rejects unknown or traversing references', async () => {
    const saved = await saveNotificationSound(directory, 'reply', sound());
    expect(await readNotificationSound(directory, 'channel', saved.id)).toBeNull();
    await expect(readNotificationSound(directory, '../reply', saved.id)).rejects.toThrow('Invalid');
    await expect(readNotificationSound(directory, 'reply', '../reply')).rejects.toThrow('Invalid');
    await expect(saveNotificationSound(directory, '../reply', sound())).rejects.toThrow('Invalid');
  });

  it.each([
    { name: '../file', dataBase64: 'bad bytes' },
    { name: 'tone', dataBase64: Buffer.from('<html>oops</html>').toString('base64') },
    { name: '\n', dataBase64: sound().dataBase64 },
    { name: 'a'.repeat(121), dataBase64: sound().dataBase64 },
    {
      name: 'too big',
      dataBase64: Buffer.alloc(MAX_NOTIFICATION_SOUND_BYTES + 1).toString('base64'),
    },
  ])('rejects invalid imports without replacing the selected recording', async (invalid) => {
    const selected = await saveNotificationSound(directory, 'channel', sound());
    await expect(saveNotificationSound(directory, 'channel', invalid)).rejects.toThrow();
    expect(await readNotificationSound(directory, 'channel', selected.id)).toBe(sound().dataBase64);
  });

  it('rejects empty, oversized, non-audio and directory selections', async () => {
    const file = path.join(directory, 'bad.wav');
    for (const bytes of [
      Buffer.alloc(0),
      Buffer.alloc(MAX_NOTIFICATION_SOUND_BYTES + 1),
      Buffer.from('not audio'),
    ]) {
      await writeFile(file, bytes);
      await expect(importNotificationSound(file)).rejects.toThrow();
    }
    await expect(importNotificationSound(directory)).rejects.toThrow();
  });

  it.runIf(process.platform === 'darwin')(
    'converts a macOS AIFF recording to WAV and removes temporary files',
    async () => {
      const bytes = Buffer.alloc(214);
      bytes.write('FORM', 0);
      bytes.writeUInt32BE(bytes.length - 8, 4);
      bytes.write('AIFFCOMM', 8);
      bytes.writeUInt32BE(18, 16);
      bytes.writeUInt16BE(1, 20);
      bytes.writeUInt32BE(80, 22);
      bytes.writeUInt16BE(16, 26);
      Buffer.from('400bfa00000000000000', 'hex').copy(bytes, 28);
      bytes.write('SSND', 38);
      bytes.writeUInt32BE(168, 42);
      const file = path.join(directory, 'system-tone.aiff');
      await writeFile(file, bytes);
      const before = (await readdir(tmpdir())).filter((name) =>
        name.startsWith('mesh-notification-sound-'),
      );
      const imported = await importNotificationSound(file);
      expect(Buffer.from(imported.dataBase64, 'base64').toString('ascii', 0, 4)).toBe('RIFF');
      expect(imported.name).toBe('system-tone.aiff');
      expect(
        (await readdir(tmpdir())).filter((name) => name.startsWith('mesh-notification-sound-')),
      ).toEqual(before);
      await writeFile(file, Buffer.from('FORM0000AIFFbroken'));
      await expect(importNotificationSound(file)).rejects.toThrow();
      expect(
        (await readdir(tmpdir())).filter((name) => name.startsWith('mesh-notification-sound-')),
      ).toEqual(before);
    },
  );

  it('detects damaged saved data and rejects unrelated hashes', async () => {
    const saved = await saveNotificationSound(directory, 'mecpSiren', sound());
    expect(await readNotificationSound(directory, 'mecpSiren', '0'.repeat(64))).toBeNull();
    await writeFile(path.join(directory, 'mecpSiren.json'), 'invalid json');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await readNotificationSound(directory, 'mecpSiren', saved.id)).toBeNull();
    const replacement = await saveNotificationSound(directory, 'mecpSiren', sound('repaired'));
    expect(await readNotificationSound(directory, 'mecpSiren', replacement.id)).toBe(
      sound('repaired').dataBase64,
    );
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
});
