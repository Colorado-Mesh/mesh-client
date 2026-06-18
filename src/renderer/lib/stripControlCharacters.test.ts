import { describe, expect, it } from 'vitest';

import { stripControlCharacters } from './stripControlCharacters';

describe('stripControlCharacters', () => {
  it('removes ASCII control characters and keeps printable text', () => {
    expect(stripControlCharacters('hello\x07world')).toBe('helloworld');
    expect(stripControlCharacters('line\x1fbreak')).toBe('linebreak');
  });
});
