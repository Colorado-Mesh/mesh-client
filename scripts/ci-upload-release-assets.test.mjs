import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findDuplicateBasenames,
  parseReleaseId,
  resolveUploadFiles,
  uploadReleaseAssets,
} from './ci-upload-release-assets.mjs';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseReleaseId', () => {
  it('accepts numeric ids', () => {
    expect(parseReleaseId('368221738')).toBe(368221738);
  });

  it('rejects non-numeric ids', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    parseReleaseId('untagged');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe('resolveUploadFiles', () => {
  it('expands globs to absolute files and skips empty patterns', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mesh-upload-'));
    writeFileSync(path.join(dir, 'a.deb'), 'a');
    writeFileSync(path.join(dir, 'b.rpm'), 'b');
    const files = resolveUploadFiles(['*.deb', '*.rpm', 'missing-*.yml'], dir);
    expect(files.map((file) => path.basename(file)).sort()).toEqual(['a.deb', 'b.rpm']);
  });

  it('fails only when every pattern yields no files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mesh-upload-empty-'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    resolveUploadFiles(['*.deb', 'missing-*.yml'], dir);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe('findDuplicateBasenames', () => {
  it('reports duplicated basenames from different directories', () => {
    expect(
      findDuplicateBasenames(['/tmp/a/latest.yml', '/tmp/b/latest.yml', '/tmp/c/other.yml']),
    ).toEqual(['latest.yml']);
  });
});

describe('uploadReleaseAssets', () => {
  it('refuses non-draft releases', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    const upload = vi.fn();
    await uploadReleaseAssets({
      releaseId: 1,
      token: 'token',
      files: ['/tmp/x.deb'],
      get: async () => ({ id: 1, draft: false, assets: [] }),
      upload,
      log: () => {},
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(upload).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('refuses duplicate basenames before uploading', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    const upload = vi.fn();
    await uploadReleaseAssets({
      releaseId: 9,
      token: 'token',
      files: ['/tmp/a/latest.yml', '/tmp/b/latest.yml'],
      get: async () => ({ id: 9, draft: true, assets: [] }),
      upload,
      log: () => {},
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(upload).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('uploads each file to a draft release by path', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mesh-upload-ok-'));
    const a = path.join(dir, 'a.deb');
    const b = path.join(dir, 'b.yml');
    writeFileSync(a, 'a');
    writeFileSync(b, 'b');
    const uploads = [];
    const count = await uploadReleaseAssets({
      releaseId: 9,
      token: 'token',
      files: [a, b],
      get: async () => ({
        id: 9,
        draft: true,
        assets: [{ id: 3, name: 'a.deb' }],
      }),
      upload: async (opts) => {
        uploads.push({ fileName: opts.fileName, filePath: opts.filePath });
        return { id: 1, name: opts.fileName };
      },
      log: () => {},
    });

    expect(count).toBe(2);
    expect(uploads).toEqual([
      { fileName: 'a.deb', filePath: a },
      { fileName: 'b.yml', filePath: b },
    ]);
  });

  it('refuses a missing upload path before calling upload (preserves prior assets)', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit:${code}`);
    });
    const upload = vi.fn();
    const missing = path.join(mkdtempSync(path.join(tmpdir(), 'mesh-upload-miss-')), 'gone.deb');
    await expect(
      uploadReleaseAssets({
        releaseId: 9,
        token: 'token',
        files: [missing],
        get: async () => ({
          id: 9,
          draft: true,
          assets: [{ id: 3, name: 'gone.deb' }],
        }),
        upload,
        log: () => {},
      }),
    ).rejects.toThrow(/exit:1/);
    expect(upload).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
