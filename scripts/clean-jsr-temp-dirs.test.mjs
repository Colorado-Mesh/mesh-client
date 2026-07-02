// @vitest-environment node
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanJsrTempDirs } from './clean-jsr-temp-dirs.mjs';

describe('cleanJsrTempDirs', () => {
  /** @type {string[]} */
  const tempRoots = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function makeTempRoot() {
    const root = mkdtempSync(path.join(tmpdir(), 'clean-jsr-'));
    tempRoots.push(root);
    return root;
  }

  it('removes @jsr/_tmp_* dirs and keeps real packages', () => {
    const root = makeTempRoot();
    const jsrDir = path.join(root, 'node_modules', '@jsr');
    mkdirSync(path.join(jsrDir, '_tmp_abc123'), { recursive: true });
    mkdirSync(path.join(jsrDir, 'meshtastic__core'), { recursive: true });
    writeFileSync(path.join(jsrDir, 'meshtastic__core', 'package.json'), '{}');

    cleanJsrTempDirs(path.join(root, 'node_modules'));

    const names = readdirSync(jsrDir).sort();
    expect(names).toEqual(['meshtastic__core']);
  });

  it('cleans nested @jsr/_tmp_* under nested node_modules', () => {
    const root = makeTempRoot();
    const nested = path.join(root, 'node_modules', '@scope', 'node_modules', '@jsr');
    mkdirSync(path.join(nested, '_tmp_nested'), { recursive: true });
    mkdirSync(path.join(nested, 'meshtastic__transport-http'), { recursive: true });

    cleanJsrTempDirs(path.join(root, 'node_modules'));

    expect(readdirSync(nested)).toEqual(['meshtastic__transport-http']);
  });

  it('no-ops when root is missing', () => {
    expect(() =>
      cleanJsrTempDirs(path.join(makeTempRoot(), 'missing', 'node_modules')),
    ).not.toThrow();
  });
});
