import { describe, expect, it } from 'vitest';

import type { ReticulumCachedAttachment } from './reticulumCachedAttachment';
import {
  parseReticulumCachedAttachmentsJson,
  serializeReticulumCachedAttachments,
} from './reticulumCachedAttachment';

describe('serializeReticulumCachedAttachments', () => {
  it('returns null for empty or missing input', () => {
    expect(serializeReticulumCachedAttachments(null)).toBeNull();
    expect(serializeReticulumCachedAttachments(undefined)).toBeNull();
    expect(serializeReticulumCachedAttachments([])).toBeNull();
  });

  it('round-trips attachments through JSON', () => {
    const items: ReticulumCachedAttachment[] = [
      { path: '/tmp/mesh-123/1.lxmf', fileName: 'one.lxmf', mimeType: 'application/lxmf' },
      { path: '/tmp/mesh-123/2.png', fileName: 'two.png', mimeType: 'image/png' },
    ];
    expect(JSON.parse(serializeReticulumCachedAttachments(items)!)).toEqual(items);
  });
});

describe('parseReticulumCachedAttachmentsJson', () => {
  it('returns [] for missing or non-string input', () => {
    expect(parseReticulumCachedAttachmentsJson(null)).toEqual([]);
    expect(parseReticulumCachedAttachmentsJson(undefined)).toEqual([]);
    expect(parseReticulumCachedAttachmentsJson(123 as unknown as string)).toEqual([]);
  });

  it('returns [] for invalid JSON or non-array payloads', () => {
    expect(parseReticulumCachedAttachmentsJson('not json')).toEqual([]);
    expect(parseReticulumCachedAttachmentsJson('{}')).toEqual([]);
    expect(parseReticulumCachedAttachmentsJson('"string"')).toEqual([]);
  });

  it('drops entries missing required string fields', () => {
    const raw = JSON.stringify([
      { path: '/a', fileName: 'a.lxmf', mimeType: 'application/lxmf' },
      { fileName: 'b.lxmf' },
      { path: '/c' },
      { path: '', fileName: '', mimeType: '' },
      'not an object',
      null,
    ]);
    expect(parseReticulumCachedAttachmentsJson(raw)).toEqual([
      { path: '/a', fileName: 'a.lxmf', mimeType: 'application/lxmf' },
    ]);
  });

  it('defaults mimeType to application/octet-stream', () => {
    const out = parseReticulumCachedAttachmentsJson(
      JSON.stringify([{ path: '/a', fileName: 'a.bin' }]),
    );
    expect(out).toEqual([{ path: '/a', fileName: 'a.bin', mimeType: 'application/octet-stream' }]);
  });
});
