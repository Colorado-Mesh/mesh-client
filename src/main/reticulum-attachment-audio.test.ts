// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  readReticulumAttachmentBytes,
  resetReticulumAttachmentAudioRateLimitForTests,
  RETICULUM_ATTACHMENT_AUDIO_MAX_BYTES,
  takeReticulumAttachmentAudioRateToken,
} from './reticulum-attachment-audio';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-rns-attach-audio-'));

vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
  },
}));

const attachmentsDir = path.join(userData, 'reticulum', 'attachments');

afterEach(() => {
  resetReticulumAttachmentAudioRateLimitForTests();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.mkdirSync(attachmentsDir, { recursive: true });
});

describe('reticulum-attachment-audio', () => {
  it('reads jailed OggS bytes as base64', async () => {
    fs.mkdirSync(attachmentsDir, { recursive: true });
    const filePath = path.join(attachmentsDir, 'memo.ogg');
    const body = Buffer.concat([Buffer.from('OggS'), Buffer.from('opus-test-payload')]);
    fs.writeFileSync(filePath, body);
    const b64 = await readReticulumAttachmentBytes(filePath);
    expect(b64).toBe(body.toString('base64'));
  });

  it('returns null for non-Ogg magic', async () => {
    fs.mkdirSync(attachmentsDir, { recursive: true });
    const filePath = path.join(attachmentsDir, 'not-ogg.bin');
    fs.writeFileSync(filePath, Buffer.from([0x00, 0x01, 0x02, 0x03]));
    await expect(readReticulumAttachmentBytes(filePath)).resolves.toBeNull();
  });

  it('rejects paths outside the attachments jail', async () => {
    const outside = path.join(userData, 'escape.bin');
    fs.writeFileSync(outside, Buffer.from('OggSxxxx'));
    await expect(readReticulumAttachmentBytes(outside)).rejects.toThrow(/outside/);
  });

  it('returns null for empty files', async () => {
    fs.mkdirSync(attachmentsDir, { recursive: true });
    const filePath = path.join(attachmentsDir, 'empty.ogg');
    fs.writeFileSync(filePath, Buffer.alloc(0));
    await expect(readReticulumAttachmentBytes(filePath)).resolves.toBeNull();
  });

  it('enforces the audio read size cap', async () => {
    fs.mkdirSync(attachmentsDir, { recursive: true });
    const filePath = path.join(attachmentsDir, 'huge.ogg');
    const huge = Buffer.alloc(RETICULUM_ATTACHMENT_AUDIO_MAX_BYTES + 16, 0x41);
    huge.write('OggS', 0);
    fs.writeFileSync(filePath, huge);
    await expect(readReticulumAttachmentBytes(filePath)).rejects.toThrow(/too large/i);
  });

  it('rate-limits attachment audio reads', () => {
    resetReticulumAttachmentAudioRateLimitForTests();
    let allowed = 0;
    for (let i = 0; i < 80; i++) {
      if (takeReticulumAttachmentAudioRateToken()) allowed += 1;
    }
    expect(allowed).toBe(60);
  });
});
