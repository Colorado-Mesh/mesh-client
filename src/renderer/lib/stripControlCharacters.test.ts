import { describe, expect, it } from 'vitest';

import { stripControlCharacters } from './stripControlCharacters';

describe('stripControlCharacters', () => {
  it('returns empty string unchanged', () => {
    expect(stripControlCharacters('')).toBe('');
  });

  it('returns strings with no control characters unchanged', () => {
    expect(stripControlCharacters('hello world')).toBe('hello world');
    expect(stripControlCharacters('printable: ABC 123 !@#')).toBe('printable: ABC 123 !@#');
  });

  it('removes ASCII control characters and keeps printable text', () => {
    expect(stripControlCharacters('hello\x07world')).toBe('helloworld');
    expect(stripControlCharacters('line\x1fbreak')).toBe('linebreak');
  });

  it('removes boundary control characters (NUL and US)', () => {
    expect(stripControlCharacters('\x00start')).toBe('start');
    expect(stripControlCharacters('end\x1f')).toBe('end');
  });

  it('removes DEL (0x7F)', () => {
    expect(stripControlCharacters('del\x7fchar')).toBe('delchar');
  });

  it('removes multiple control characters in one string', () => {
    expect(stripControlCharacters('\x00a\x1fb\x7fc')).toBe('abc');
  });
});
