// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  RETICULUM_ATTACHMENT_MAX_FILES,
  RETICULUM_ATTACHMENT_MAX_TOTAL_BYTES,
  RETICULUM_IMAGE_MAX_BYTES,
} from '@/shared/reticulum-attachment-types';

import {
  bytesToBase64,
  prepareReticulumFileAttachments,
  prepareReticulumPhotoAttachment,
} from './prepareReticulumAttachments';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function file(name: string, bytes: Uint8Array | string, type = ''): File {
  return new File([bytes as BlobPart], name, { type });
}

describe('prepareReticulumFileAttachments', () => {
  it('sanitises names and defaults MIME', async () => {
    const res = await prepareReticulumFileAttachments([file('../x[1]:a.txt', 'hi')]);
    expect(res.ok).toBe(true);
    if (!res.ok || res.prepared.kind !== 'files') throw new Error('expected files');
    expect(res.prepared.files[0].fileName).toBe('x_1__a.txt');
    expect(res.prepared.files[0].mimeType).toBe('application/octet-stream');
  });

  it('rejects empty, too many and oversize sets without reading', async () => {
    expect(await prepareReticulumFileAttachments([])).toEqual({ ok: false, error: 'no_files' });
    expect(await prepareReticulumFileAttachments([file('e.txt', '')])).toEqual({
      ok: false,
      error: 'attachment_empty',
    });
    const many = Array.from({ length: RETICULUM_ATTACHMENT_MAX_FILES + 1 }, (_, i) =>
      file(`f${i}.txt`, 'x'),
    );
    expect(await prepareReticulumFileAttachments(many)).toEqual({
      ok: false,
      error: 'attachment_count_exceeded',
    });
    const big = file('big.bin', new Uint8Array(RETICULUM_ATTACHMENT_MAX_TOTAL_BYTES + 1));
    expect(await prepareReticulumFileAttachments([big])).toEqual({
      ok: false,
      error: 'attachment_too_large',
    });
  });
});

describe('prepareReticulumPhotoAttachment (no canvas in jsdom → verified pass-through)', () => {
  it('accepts a small PNG and keeps format from magic bytes', async () => {
    const res = await prepareReticulumPhotoAttachment(file('shot.PNG', PNG, 'image/png'));
    expect(res.ok).toBe(true);
    if (!res.ok || res.prepared.kind !== 'photo') throw new Error('expected photo');
    expect(res.prepared.photo.format).toBe('png');
    expect(res.prepared.photo.fileName).toBe('shot.png');
  });

  it('rejects non-raster content labelled as an image', async () => {
    const res = await prepareReticulumPhotoAttachment(
      file('x.png', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/png'),
    );
    expect(res).toEqual({ ok: false, error: 'photo_unsupported' });
  });

  it('rejects non-image MIME and oversize pass-through', async () => {
    expect(await prepareReticulumPhotoAttachment(file('a.txt', 'x', 'text/plain'))).toEqual({
      ok: false,
      error: 'photo_unsupported',
    });
    const big = new Uint8Array(RETICULUM_IMAGE_MAX_BYTES + 1);
    big.set(PNG);
    expect(await prepareReticulumPhotoAttachment(file('b.png', big, 'image/png'))).toEqual({
      ok: false,
      error: 'image_too_large',
    });
  });
});

describe('bytesToBase64', () => {
  it('matches btoa for large buffers (chunked)', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    let ref = '';
    for (const b of bytes) ref += String.fromCharCode(b);
    expect(bytesToBase64(bytes)).toBe(btoa(ref));
  });
});
