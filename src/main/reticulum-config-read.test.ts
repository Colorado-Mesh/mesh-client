// @vitest-environment node
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readUtf8FileBounded } from './reticulum-config-read';

const FIXTURE_DIR = path.join(__dirname, 'fixtures/reticulum-config-read');

describe('readUtf8FileBounded', () => {
  it('reads small UTF-8 files', () => {
    const file = path.join(FIXTURE_DIR, 'small.txt');
    expect(readUtf8FileBounded(file, 1024)).toContain('interfaces:');
  });

  it('rejects files larger than maxBytes', () => {
    const file = path.join(FIXTURE_DIR, 'oversized.txt');
    expect(() => readUtf8FileBounded(file, 16)).toThrow(/exceeds 16 byte limit/);
  });
});
