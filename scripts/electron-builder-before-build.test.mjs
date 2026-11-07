import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findUsocketPackageDirs, stripUsocketPackages } from './electron-builder-before-build.mjs';

describe('electron-builder-before-build usocket strip', () => {
  it('finds nested usocket package dirs by package.json name', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-usocket-find-'));
    const top = path.join(root, 'usocket');
    const nested = path.join(root, 'dbus-next', 'node_modules', 'usocket');
    const decoy = path.join(root, 'other', 'usocket');
    mkdirSync(top, { recursive: true });
    mkdirSync(nested, { recursive: true });
    mkdirSync(decoy, { recursive: true });
    writeFileSync(
      path.join(top, 'package.json'),
      JSON.stringify({ name: 'usocket', version: '0.3.0' }),
    );
    writeFileSync(
      path.join(nested, 'package.json'),
      JSON.stringify({ name: 'usocket', version: '0.3.0' }),
    );
    writeFileSync(path.join(decoy, 'package.json'), JSON.stringify({ name: 'not-usocket' }));
    writeFileSync(path.join(decoy, 'index.js'), 'export {}');

    const found = findUsocketPackageDirs(root).sort();
    expect(found).toEqual([nested, top].sort());
  });

  it('removes usocket packages and leaves unrelated dirs', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-usocket-strip-'));
    const usocketDir = path.join(root, 'usocket');
    const keepDir = path.join(root, 'serialport');
    mkdirSync(usocketDir, { recursive: true });
    mkdirSync(keepDir, { recursive: true });
    writeFileSync(
      path.join(usocketDir, 'package.json'),
      JSON.stringify({ name: 'usocket', version: '0.3.0' }),
    );
    writeFileSync(path.join(usocketDir, 'binding.gyp'), '{}');
    writeFileSync(
      path.join(keepDir, 'package.json'),
      JSON.stringify({ name: 'serialport', version: '1.0.0' }),
    );

    const removed = stripUsocketPackages(root);
    expect(removed).toEqual([usocketDir]);
    expect(existsSync(usocketDir)).toBe(false);
    expect(JSON.parse(readFileSync(path.join(keepDir, 'package.json'), 'utf8')).name).toBe(
      'serialport',
    );
  });

  it('is a no-op when node_modules has no usocket', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-usocket-empty-'));
    mkdirSync(path.join(root, 'foo'), { recursive: true });
    expect(stripUsocketPackages(root)).toEqual([]);
  });
});
