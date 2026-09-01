import { describe, expect, it } from 'vitest';

import { touch } from './touch';

describe('touch', () => {
  it('accepts any value without throwing', () => {
    expect(() => {
      touch(undefined);
    }).not.toThrow();
    expect(() => {
      touch(null);
    }).not.toThrow();
    expect(() => {
      touch(0);
    }).not.toThrow();
    expect(() => {
      touch({ a: 1 });
    }).not.toThrow();
  });
});
