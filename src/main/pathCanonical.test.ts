import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { canonicalizePath, isSameCanonicalPath, isUnderCanonicalRoot } from './pathCanonical';

describe('pathCanonical', () => {
  it('canonicalizes an existing path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-canon-'));
    try {
      const file = path.join(dir, 'a.txt');
      fs.writeFileSync(file, 'x');
      expect(canonicalizePath(file)).toBe(fs.realpathSync.native(file));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('canonicalizes a missing leaf under an existing parent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-canon-'));
    try {
      const missing = path.join(dir, 'nested', 'out.bin');
      const realDir = fs.realpathSync.native(dir);
      expect(canonicalizePath(missing)).toBe(path.join(realDir, 'nested', 'out.bin'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects symlink escape outside an allowed root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-canon-root-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-canon-out-'));
    try {
      const secret = path.join(outside, 'secret.txt');
      fs.writeFileSync(secret, 'nope');
      const link = path.join(root, 'escape');
      fs.symlinkSync(secret, link);
      expect(isUnderCanonicalRoot(link, root)).toBe(false);
      expect(isSameCanonicalPath(link, secret)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('allows nested paths under the canonical root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-canon-nest-'));
    try {
      expect(isUnderCanonicalRoot(path.join(root, 'a', 'b.bin'), root)).toBe(true);
      expect(isUnderCanonicalRoot(root, root)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
