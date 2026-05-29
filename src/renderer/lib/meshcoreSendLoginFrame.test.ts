import { describe, expect, it } from 'vitest';

/** Mirrors patched meshcore.js BufferWriter.writeCString used by SendLogin. */
function writeCString(password: string, maxLength: number): Uint8Array {
  const bytes = new Uint8Array(new ArrayBuffer(maxLength));
  const encodedString = new TextEncoder().encode(password);
  for (let i = 0; i < maxLength && i < encodedString.length; i++) {
    bytes[i] = encodedString[i]!;
  }
  bytes[bytes.length - 1] = 0;
  return bytes;
}

/** Mirrors patched meshcore.js sendCommandSendLogin password field. */
function buildLoginPasswordField(password: string): Uint8Array {
  if (password.length === 0) {
    return writeCString(password, 16);
  }
  return new TextEncoder().encode(password);
}

describe('meshcore SendLogin password framing', () => {
  it('encodes empty password as a null-terminated C string', () => {
    const field = buildLoginPasswordField('');
    expect(field.length).toBe(16);
    expect(field[0]).toBe(0);
  });

  it('encodes non-empty guest password as variable-length bytes', () => {
    const field = buildLoginPasswordField('hello');
    expect(Array.from(field)).toEqual(Array.from(new TextEncoder().encode('hello')));
  });
});
