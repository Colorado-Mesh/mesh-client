import { describe, expect, it } from 'vitest';

import { isValidMicronPageName } from '@/renderer/lib/nomad/micronPageName';

describe('isValidMicronPageName', () => {
  it('accepts plain and nested .mu names', () => {
    expect(isValidMicronPageName('index.mu')).toBe(true);
    expect(isValidMicronPageName('page/foo.mu')).toBe(true);
    expect(isValidMicronPageName('  index.mu  ')).toBe(true);
    expect(isValidMicronPageName('INDEX.MU')).toBe(true);
  });

  it('requires a .mu extension', () => {
    expect(isValidMicronPageName('index')).toBe(false);
    expect(isValidMicronPageName('index.txt')).toBe(false);
    expect(isValidMicronPageName('.mu')).toBe(true);
  });

  it('rejects empty names', () => {
    expect(isValidMicronPageName('')).toBe(false);
    expect(isValidMicronPageName('   ')).toBe(false);
  });

  it('rejects traversal and absolute paths', () => {
    expect(isValidMicronPageName('../escape.mu')).toBe(false);
    expect(isValidMicronPageName('page/../../escape.mu')).toBe(false);
    expect(isValidMicronPageName('/abs/index.mu')).toBe(false);
    expect(isValidMicronPageName('\\abs\\index.mu')).toBe(false);
    expect(isValidMicronPageName('page\\foo.mu')).toBe(false);
  });

  it('rejects empty path segments and control characters', () => {
    expect(isValidMicronPageName('page//foo.mu')).toBe(false);
    expect(isValidMicronPageName('page/ /foo.mu')).toBe(false);
    expect(isValidMicronPageName('page/\u0000foo.mu')).toBe(false);
  });
});
