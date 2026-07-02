import { describe, expect, it } from 'vitest';

import {
  isReticulumAudioAttachment,
  isReticulumImageAttachment,
  parseReticulumAttachmentPayload,
} from './parseReticulumAttachmentPayload';

describe('parseReticulumAttachmentPayload', () => {
  it('parses LXMF file marker', () => {
    expect(parseReticulumAttachmentPayload('[file:photo.png:image/png]')).toEqual({
      fileName: 'photo.png',
      mimeType: 'image/png',
    });
  });

  it('returns null for plain text', () => {
    expect(parseReticulumAttachmentPayload('hello')).toBeNull();
  });

  it('detects image mime types', () => {
    expect(isReticulumImageAttachment('image/jpeg')).toBe(true);
    expect(isReticulumImageAttachment('application/pdf')).toBe(false);
  });

  it('detects audio mime types', () => {
    expect(isReticulumAudioAttachment('audio/webm')).toBe(true);
    expect(isReticulumAudioAttachment('text/plain')).toBe(false);
  });
});
