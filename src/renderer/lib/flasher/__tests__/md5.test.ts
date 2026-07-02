import { md5 } from 'js-md5';
import { describe, expect, it } from 'vitest';

import { md5Latin1String } from '../md5';

describe('md5Latin1String', () => {
  it('hashes high-byte Latin-1 strings as raw bytes, not UTF-8', () => {
    const binary = String.fromCharCode(0xff, 0x00, 0x80, 0x7f);
    const expected = md5.hex(new Uint8Array([0xff, 0x00, 0x80, 0x7f]));

    expect(md5Latin1String(binary)).toBe(expected);
    expect(md5Latin1String(binary)).toBe('db88b5a58c9d4382af9f1c88ccd129bf');
    expect(md5(binary)).not.toBe(expected);
  });

  it('matches UTF-8 md5 for ASCII-only strings', () => {
    const ascii = 'hello';
    expect(md5Latin1String(ascii)).toBe(md5(ascii));
  });
});
