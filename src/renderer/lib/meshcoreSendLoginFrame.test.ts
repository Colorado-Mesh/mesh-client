import { describe, expect, it } from 'vitest';

/** Mirrors patched meshcore.js sendCommandSendLogin password field. */
function buildLoginPasswordField(password: string): Uint8Array {
  if (password.length === 0) {
    return new Uint8Array(0);
  }
  return new TextEncoder().encode(password);
}

describe('meshcore SendLogin password framing', () => {
  it('encodes empty password as zero bytes (read-only ACL)', () => {
    const field = buildLoginPasswordField('');
    expect(field.length).toBe(0);
  });

  it('encodes non-empty guest password as variable-length bytes', () => {
    const field = buildLoginPasswordField('hello');
    expect(Array.from(field)).toEqual(Array.from(new TextEncoder().encode('hello')));
  });
});
