import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeReticulumAttachmentCacheFile } from './reticulum-attachment-store';

describe('writeReticulumAttachmentCacheFile', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-ret-att-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes a plain document into the attachments dir with mode 0600', async () => {
    const res = await writeReticulumAttachmentCacheFile(root, 'notes.txt', Buffer.from('hi'), 42);
    expect(res.quarantined).toBe(false);
    expect(res.path).toBe(path.join(root, '42-notes.txt'));
    expect(fs.readFileSync(res.path, 'utf8')).toBe('hi');
    if (process.platform !== 'win32') {
      expect(fs.statSync(res.path).mode & 0o777).toBe(0o600);
    }
  });

  it.each(['payload.exe', 'run.SH', 'report.pdf.exe', 'x.command', 'setup.msi'])(
    'quarantines risky name %s',
    async (name) => {
      const res = await writeReticulumAttachmentCacheFile(root, name, Buffer.from('MZ'), 7);
      expect(res.quarantined).toBe(true);
      expect(path.dirname(res.path)).toBe(path.join(root, 'quarantine'));
      expect(res.path.endsWith('.quarantine')).toBe(true);
      if (process.platform !== 'win32') {
        expect(fs.statSync(res.path).mode & 0o111).toBe(0);
      }
    },
  );

  it('neutralises path traversal and marker characters in the name', async () => {
    const res = await writeReticulumAttachmentCacheFile(
      root,
      '../../etc/pass[wd]:x.txt',
      Buffer.from('x'),
      1,
    );
    expect(path.dirname(res.path)).toBe(root);
    expect(path.basename(res.path)).toBe('1-pass_wd__x.txt');
  });

  it('never overwrites a same-millisecond twin', async () => {
    const a = await writeReticulumAttachmentCacheFile(root, 'a.txt', Buffer.from('1'), 5);
    const b = await writeReticulumAttachmentCacheFile(root, 'a.txt', Buffer.from('2'), 5);
    expect(a.path).not.toBe(b.path);
    expect(fs.readFileSync(a.path, 'utf8')).toBe('1');
    expect(fs.readFileSync(b.path, 'utf8')).toBe('2');
  });
});
