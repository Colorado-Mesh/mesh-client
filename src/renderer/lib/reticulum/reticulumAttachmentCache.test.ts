// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheReticulumInboundAttachment } from './reticulumAttachmentCache';

describe('cacheReticulumInboundAttachment', () => {
  beforeEach(() => {
    vi.spyOn(window.electronAPI.chat, 'saveReticulumAttachment').mockResolvedValue({
      success: false,
    });
  });

  it('returns null when data_base64 is missing', async () => {
    const result = await cacheReticulumInboundAttachment({ file_name: 'note.txt' });
    expect(result).toBeNull();
    expect(window.electronAPI.chat.saveReticulumAttachment).not.toHaveBeenCalled();
  });

  it('returns path when save succeeds', async () => {
    vi.mocked(window.electronAPI.chat.saveReticulumAttachment).mockResolvedValue({
      success: true,
      path: '/tmp/reticulum/attachments/1-note.txt',
    });
    const result = await cacheReticulumInboundAttachment({
      file_name: 'note.txt',
      mime_type: 'text/plain',
      data_base64: 'aGVsbG8=',
    });
    expect(result).toBe('/tmp/reticulum/attachments/1-note.txt');
  });

  it('returns null when save rejects oversize payload', async () => {
    vi.mocked(window.electronAPI.chat.saveReticulumAttachment).mockRejectedValue(
      new Error('dataBase64 invalid or too large'),
    );
    const oversizedBase64 = 'A'.repeat(17 * 1024 * 1024);
    const result = await cacheReticulumInboundAttachment({
      file_name: 'big.bin',
      data_base64: oversizedBase64,
    });
    expect(result).toBeNull();
  });
});
