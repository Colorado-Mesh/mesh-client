import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertPathInsideRoot,
  assertSafePathSegment,
  isPathInsideRoot,
  joinUnderRoot,
  PathEscapesRootError,
  resolveUnderRoot,
} from './path-under-root.mjs';

describe('path-under-root', () => {
  const root = path.join(os.tmpdir(), 'mesh-path-under-root-fixture');

  it('joinUnderRoot keeps results inside root', () => {
    const joined = joinUnderRoot(root, 'a', 'b.txt');
    expect(joined).toBe(path.resolve(root, 'a', 'b.txt'));
    expect(isPathInsideRoot(root, joined)).toBe(true);
  });

  it('joinUnderRoot rejects .. and separators in segments', () => {
    expect(() => joinUnderRoot(root, '..')).toThrow(PathEscapesRootError);
    expect(() => joinUnderRoot(root, 'a/b')).toThrow(PathEscapesRootError);
    expect(() => joinUnderRoot(root, 'a\\b')).toThrow(PathEscapesRootError);
  });

  it('resolveUnderRoot allows nested relative paths and rejects traversal', () => {
    expect(resolveUnderRoot(root, 'foo/bar.kml')).toBe(path.resolve(root, 'foo', 'bar.kml'));
    expect(() => resolveUnderRoot(root, '../etc/passwd')).toThrow(PathEscapesRootError);
    expect(() => resolveUnderRoot(root, '/etc/passwd')).toThrow(PathEscapesRootError);
    expect(() => resolveUnderRoot(root, 'foo/../../etc/passwd')).toThrow(PathEscapesRootError);
  });

  it('assertSafePathSegment rejects empty and absolute values', () => {
    expect(() => assertSafePathSegment('')).toThrow(PathEscapesRootError);
    expect(() => assertSafePathSegment('/tmp')).toThrow(PathEscapesRootError);
    expect(assertSafePathSegment('tile.png')).toBe('tile.png');
  });

  it('isPathInsideRoot treats root itself as inside', () => {
    expect(isPathInsideRoot(root, root)).toBe(true);
    expect(isPathInsideRoot(root, path.join(root, 'x'))).toBe(true);
    expect(isPathInsideRoot(root, path.join(root, '..', 'other'))).toBe(false);
  });

  describe('when the root is the filesystem root', () => {
    // `/` on POSIX, the current drive (for example `C:\`) on Windows: ends in the separator.
    const fsRoot = path.parse(path.resolve(os.tmpdir())).root;

    it('joinUnderRoot accepts a direct child', () => {
      expect(joinUnderRoot(fsRoot, 'identity.json')).toBe(path.resolve(fsRoot, 'identity.json'));
    });

    it('isPathInsideRoot and assertPathInsideRoot accept descendants', () => {
      const nested = path.join(fsRoot, 'a', 'b.txt');
      expect(isPathInsideRoot(fsRoot, nested)).toBe(true);
      expect(isPathInsideRoot(fsRoot, fsRoot)).toBe(true);
      expect(assertPathInsideRoot(fsRoot, nested)).toBe(path.resolve(nested));
    });

    it('still rejects traversal segments', () => {
      expect(() => joinUnderRoot(fsRoot, '..')).toThrow(PathEscapesRootError);
      expect(() => resolveUnderRoot(fsRoot, '../x')).toThrow(PathEscapesRootError);
    });
  });
});
