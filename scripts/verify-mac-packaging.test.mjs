// @vitest-environment node
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import {
  VerificationFailure,
  fail,
  isCompleteAppBundle,
  pickPrimaryArchive,
} from './verify-mac-packaging.mjs';

describe('verify-mac-packaging helpers', () => {
  it('fail throws VerificationFailure for finally detach cleanup', () => {
    let detached = false;
    try {
      try {
        fail('validation failed');
      } finally {
        detached = true;
      }
    } catch (e) {
      expect(e).toBeInstanceOf(VerificationFailure);
      expect(e.message).toBe('validation failed');
    }
    expect(detached).toBe(true);
  });

  it('pickPrimaryArchive chooses the largest file', () => {
    const dir = join(tmpdir(), `verify-mac-packaging-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const small = join(dir, 'small.zip');
      const large = join(dir, 'large.zip');
      const medium = join(dir, 'medium.zip');
      writeFileSync(small, 'a');
      writeFileSync(medium, 'abc');
      writeFileSync(large, 'abcdefgh');
      expect(pickPrimaryArchive([small, large, medium])).toBe(large);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('isCompleteAppBundle returns false for missing launcher paths', () => {
    expect(isCompleteAppBundle('/nonexistent/Mesh-client.app')).toBe(false);
  });
});
