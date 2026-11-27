import { describe, expect, it } from 'vitest';

describe('worker Buffer polyfill', () => {
  it('supports base64url like Node', async () => {
    const { Buffer: BrowserBuffer } = await import('buffer/index.js');
    // Node's Buffer is the reference; the patched browser Buffer must match it.
    const { installBase64Url } = await import('./bufferBase64Url');
    installBase64Url(BrowserBuffer);
    const bytes = Uint8Array.from([251, 255, 190, 0, 1, 62, 63]);
    const b = BrowserBuffer.from(bytes);
    expect(b.toString('base64url')).toBe(Buffer.from(bytes).toString('base64url'));
    const text = Buffer.from(bytes).toString('base64url');
    expect(Array.from(BrowserBuffer.from(text, 'base64url' as BufferEncoding))).toEqual(
      Array.from(bytes),
    );
    expect(BrowserBuffer.byteLength(text, 'base64url')).toBe(bytes.length);
    expect(BrowserBuffer.isEncoding('base64url')).toBe(true);
  });
});
