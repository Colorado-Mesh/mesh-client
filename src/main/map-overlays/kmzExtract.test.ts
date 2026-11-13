import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';

import { assertSafeZipEntryName, extractKmlTextFromKmz, KmzExtractError } from './kmzExtract';

async function zipWith(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(entries)) {
    zip.file(name, data);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('assertSafeZipEntryName', () => {
  const root = path.join(tmpdir(), 'mesh-kmz-guard-test');

  it('rejects path traversal and absolute entries (JSZip sanitizes .. in fixtures)', () => {
    expect(() => assertSafeZipEntryName('../evil.kml', root)).toThrow(KmzExtractError);
    expect(() => assertSafeZipEntryName('/tmp/evil.kml', root)).toThrow(KmzExtractError);
    expect(() => assertSafeZipEntryName('ok/doc.kml', root)).not.toThrow();
  });
});

describe('extractKmlTextFromKmz', () => {
  it('extracts doc.kml via mkdtempSync(mesh-kmz-)', async () => {
    const spy = vi.spyOn(fs, 'mkdtempSync');
    const buf = await zipWith({
      'doc.kml': `<kml><Placemark><Point><coordinates>1,2</coordinates></Point></Placemark></kml>`,
      'readme.txt': 'ignore me',
    });
    const text = await extractKmlTextFromKmz(buf);
    expect(text).toContain('<coordinates>1,2</coordinates>');
    expect(spy).toHaveBeenCalled();
    const arg = spy.mock.calls[0]?.[0];
    expect(typeof arg === 'string' ? arg : '').toContain(path.join(tmpdir(), 'mesh-kmz-'));
    spy.mockRestore();
  });

  it('rejects archives with no KML', async () => {
    const buf = await zipWith({ 'only.txt': 'nope' });
    await expect(extractKmlTextFromKmz(buf)).rejects.toMatchObject({ code: 'empty' });
  });

  it('rejects oversize input buffers', async () => {
    const big = Buffer.alloc(50 * 1024 * 1024 + 1);
    await expect(extractKmlTextFromKmz(big)).rejects.toMatchObject({ code: 'too_large' });
  });
});
