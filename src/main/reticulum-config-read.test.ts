// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readUtf8FileBounded } from './reticulum-config-read';

describe('readUtf8FileBounded', () => {
  const tmpFiles: string[] = [];

  afterEach(() => {
    for (const file of tmpFiles.splice(0)) {
      try {
        fs.unlinkSync(file);
      } catch {
        // catch-no-log-ok test cleanup
      }
    }
  });

  it('reads small UTF-8 files', () => {
    const file = path.join(os.tmpdir(), `reticulum-config-read-${Date.now()}.txt`);
    tmpFiles.push(file);
    fs.writeFileSync(file, 'interfaces:\n  - id: test\n');
    expect(readUtf8FileBounded(file, 1024)).toContain('interfaces:');
  });

  it('rejects files larger than maxBytes', () => {
    const file = path.join(os.tmpdir(), `reticulum-config-read-big-${Date.now()}.txt`);
    tmpFiles.push(file);
    fs.writeFileSync(file, 'x'.repeat(32));
    expect(() => readUtf8FileBounded(file, 16)).toThrow(/exceeds 16 byte limit/);
  });
});
