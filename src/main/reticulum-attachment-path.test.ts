// @vitest-environment node
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertReticulumAttachmentPathJailed,
  getReticulumAttachmentsDir,
  isReticulumAttachmentPathJailed,
  sanitizeReticulumAttachmentPathForDb,
} from './reticulum-attachment-path';

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join('/tmp', 'mesh-client-test-userdata'),
  },
}));

describe('reticulum-attachment-path', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('jails paths under userData/reticulum/attachments', () => {
    const dir = getReticulumAttachmentsDir();
    const inside = path.join(dir, 'file.bin');
    expect(isReticulumAttachmentPathJailed(inside)).toBe(true);
    expect(assertReticulumAttachmentPathJailed(inside)).toBe(path.resolve(inside));
  });

  it('rejects paths outside the attachments directory', () => {
    expect(isReticulumAttachmentPathJailed('/etc/passwd')).toBe(false);
    expect(() => assertReticulumAttachmentPathJailed('/etc/passwd')).toThrow(/outside/);
  });

  it('sanitizeReticulumAttachmentPathForDb returns null for traversal paths', () => {
    expect(sanitizeReticulumAttachmentPathForDb('/etc/passwd')).toBeNull();
    const dir = getReticulumAttachmentsDir();
    expect(sanitizeReticulumAttachmentPathForDb(path.join(dir, 'ok.bin'))).toBe(
      path.resolve(path.join(dir, 'ok.bin')),
    );
  });
});
