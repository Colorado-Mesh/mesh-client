import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
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
});
