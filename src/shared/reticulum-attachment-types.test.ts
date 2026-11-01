import { describe, expect, it } from 'vitest';

import {
  isRiskyReticulumAttachmentFileName,
  parseReticulumAttachmentErrorCode,
  planReticulumAttachmentStore,
  reticulumImageWireFormatFromMime,
  sanitizeReticulumAttachmentFileName,
  sniffReticulumImageWireFormat,
} from './reticulum-attachment-types';

describe('sanitizeReticulumAttachmentFileName', () => {
  it('strips directories, markers, bidi and reserved names', () => {
    expect(sanitizeReticulumAttachmentFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeReticulumAttachmentFileName('C:\\evil\\a.exe')).toBe('a.exe');
    expect(sanitizeReticulumAttachmentFileName('a:b]c[d.txt')).toBe('a_b_c_d.txt');
    expect(sanitizeReticulumAttachmentFileName('inv\u202egpj.exe')).toBe('inv_gpj.exe');
    expect(sanitizeReticulumAttachmentFileName('  ...hidden ')).toBe('hidden');
    expect(sanitizeReticulumAttachmentFileName('   ')).toBe('attachment');
    expect(sanitizeReticulumAttachmentFileName('nul.txt')).toBe('_nul.txt');
  });

  it('caps length but keeps a short extension (matches sidecar)', () => {
    const out = sanitizeReticulumAttachmentFileName(`${'a'.repeat(300)}.pdf`);
    expect(Array.from(out)).toHaveLength(96);
    expect(out.endsWith('.pdf')).toBe(true);
  });
});

describe('risky attachment policy', () => {
  it.each(['a.exe', 'A.SH', 'doc.pdf.exe', 'x.command', 'y.ps1', 'z.jar'])('flags %s', (name) => {
    expect(isRiskyReticulumAttachmentFileName(name)).toBe(true);
  });
  it.each(['photo.png', 'notes.txt', 'data.csv', 'archive.zip', 'image.bin'])(
    'allows %s',
    (name) => {
      expect(isRiskyReticulumAttachmentFileName(name)).toBe(false);
    },
  );
  it('plans quarantine for risky names only', () => {
    expect(planReticulumAttachmentStore('run.exe')).toEqual({
      fileName: 'run.exe.quarantine',
      subdir: 'quarantine',
      quarantined: true,
    });
    expect(planReticulumAttachmentStore('a b.txt')).toEqual({
      fileName: 'a b.txt',
      subdir: '',
      quarantined: false,
    });
  });
});

describe('image wire format', () => {
  it('maps MIME and sniffs magic bytes', () => {
    expect(reticulumImageWireFormatFromMime('image/jpeg; q=1')).toBe('jpeg');
    expect(reticulumImageWireFormatFromMime('image/svg+xml')).toBeNull();
    expect(reticulumImageWireFormatFromMime('image/heic')).toBeNull();
    expect(
      sniffReticulumImageWireFormat(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])),
    ).toBe('png');
    expect(sniffReticulumImageWireFormat(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniffReticulumImageWireFormat(Uint8Array.from([1, 2, 3]))).toBeNull();
  });
});

describe('parseReticulumAttachmentErrorCode', () => {
  it('extracts known codes from sidecar errors', () => {
    expect(parseReticulumAttachmentErrorCode('attachment_too_large: 300000 > 245760')).toBe(
      'attachment_too_large',
    );
    expect(parseReticulumAttachmentErrorCode('Error: image_magic_mismatch: png')).toBe(
      'image_magic_mismatch',
    );
    expect(parseReticulumAttachmentErrorCode('nope')).toBeNull();
    expect(parseReticulumAttachmentErrorCode(undefined)).toBeNull();
  });
});
