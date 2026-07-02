// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readUtf8FileBounded } from './reticulum-config-read';

describe('readUtf8FileBounded', () => {
  let tmpDir = '';

  afterEach(() => {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // catch-no-log-ok test cleanup
      }
      tmpDir = '';
    }
  });

  it('reads small UTF-8 files', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-config-read-'));
    const file = path.join(tmpDir, 'config.txt');
    fs.writeFileSync(file, 'interfaces:\n  - id: test\n');
    expect(readUtf8FileBounded(file, 1024)).toContain('interfaces:');
  });

  it('rejects files larger than maxBytes', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-config-read-big-'));
    const file = path.join(tmpDir, 'big.txt');
    fs.writeFileSync(file, 'x'.repeat(32));
    expect(() => readUtf8FileBounded(file, 16)).toThrow(/exceeds 16 byte limit/);
  });
});
