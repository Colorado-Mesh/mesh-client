import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
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
  it('expands globs to absolute files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mesh-upload-'));
    writeFileSync(path.join(dir, 'a.deb'), 'a');
    writeFileSync(path.join(dir, 'b.rpm'), 'b');
    const files = resolveUploadFiles(['*.deb', '*.rpm'], dir);
    expect(files.map((file) => path.basename(file)).sort()).toEqual(['a.deb', 'b.rpm']);
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

  it('uploads each file to a draft release', async () => {
    const uploads = [];
    const count = await uploadReleaseAssets({
      releaseId: 9,
      token: 'token',
      files: ['/tmp/a.deb', '/tmp/b.yml'],
      get: async () => ({
        id: 9,
        draft: true,
        assets: [{ id: 3, name: 'a.deb' }],
      }),
      readFile: (filePath) => new Uint8Array(Buffer.from(path.basename(filePath))),
      upload: async (opts) => {
        uploads.push(opts.fileName);
        return { id: 1, name: opts.fileName };
      },
      log: () => {},
    });

    expect(count).toBe(2);
    expect(uploads).toEqual(['a.deb', 'b.yml']);
  });
});
