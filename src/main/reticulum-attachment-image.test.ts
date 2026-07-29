// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  detectRasterImageMimeFromBytes,
  readReticulumAttachmentAsDataUrl,
  resolveReticulumAttachmentImageMime,
  RETICULUM_ATTACHMENT_IMAGE_MAX_BYTES,
} from './reticulum-attachment-image';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-rns-attach-'));

vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
  },
}));

const attachmentsDir = path.join(userData, 'reticulum', 'attachments');

afterEach(() => {
  fs.rmSync(attachmentsDir, { recursive: true, force: true });
});

describe('reticulum-attachment-image', () => {
  it('detects jpeg/png/gif/webp magic', () => {
    expect(detectRasterImageMimeFromBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    );
    expect(
      detectRasterImageMimeFromBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image/png');
    expect(detectRasterImageMimeFromBytes(Buffer.from('GIF89a......'))).toBe('image/gif');
    const webp = Buffer.alloc(12);
    webp.write('RIFF', 0);
    webp.write('WEBP', 8);
    expect(detectRasterImageMimeFromBytes(webp)).toBe('image/webp');
  });

  it('rejects unknown magic even with allowlisted mime hint', () => {
    expect(resolveReticulumAttachmentImageMime(Buffer.from([1, 2, 3]))).toBeNull();
    expect(resolveReticulumAttachmentImageMime(Buffer.from('<svg'))).toBeNull();
  });

  it('reads a jailed PNG as a data URL', async () => {
    fs.mkdirSync(attachmentsDir, { recursive: true });
    const filePath = path.join(attachmentsDir, 'shot.png');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    fs.writeFileSync(filePath, png);
    const dataUrl = await readReticulumAttachmentAsDataUrl(filePath);
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('returns null for empty files', async () => {
    fs.mkdirSync(attachmentsDir, { recursive: true });
    const filePath = path.join(attachmentsDir, 'empty.png');
    fs.writeFileSync(filePath, Buffer.alloc(0));
    expect(await readReticulumAttachmentAsDataUrl(filePath)).toBeNull();
  });

  it('returns null when bytes are not raster despite png hint', async () => {
    fs.mkdirSync(attachmentsDir, { recursive: true });
    const filePath = path.join(attachmentsDir, 'fake.png');
    fs.writeFileSync(filePath, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    expect(await readReticulumAttachmentAsDataUrl(filePath)).toBeNull();
  });

  it('throws when path is a directory', async () => {
    fs.mkdirSync(attachmentsDir, { recursive: true });
    await expect(readReticulumAttachmentAsDataUrl(attachmentsDir)).rejects.toThrow(/not a file/);
  });

  it('detects BMP and AVIF magic', () => {
    expect(detectRasterImageMimeFromBytes(Buffer.from([0x42, 0x4d, 0x00]))).toBe('image/bmp');
    const avif = Buffer.alloc(12);
    avif.write('....', 0);
    avif.write('ftyp', 4);
    avif.write('avif', 8);
    expect(detectRasterImageMimeFromBytes(avif)).toBe('image/avif');
  });

  it('rejects paths outside the attachments jail', async () => {
    await expect(readReticulumAttachmentAsDataUrl('/etc/passwd')).rejects.toThrow(/outside/);
  });

  it('rejects symlink escapes outside the attachments jail', async () => {
    fs.mkdirSync(attachmentsDir, { recursive: true });
    const outside = path.join(userData, 'secret.png');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    fs.writeFileSync(outside, png);
    const linkPath = path.join(attachmentsDir, 'escape.png');
    fs.symlinkSync(outside, linkPath);
    await expect(readReticulumAttachmentAsDataUrl(linkPath)).rejects.toThrow(/outside/);
  });

  it('rejects oversized files', async () => {
    fs.mkdirSync(attachmentsDir, { recursive: true });
    const filePath = path.join(attachmentsDir, 'big.bin');
    const huge = Buffer.alloc(RETICULUM_ATTACHMENT_IMAGE_MAX_BYTES + 1, 0xff);
    huge[0] = 0xff;
    huge[1] = 0xd8;
    huge[2] = 0xff;
    fs.writeFileSync(filePath, huge);
    await expect(readReticulumAttachmentAsDataUrl(filePath)).rejects.toThrow(/too large/i);
  });
});
