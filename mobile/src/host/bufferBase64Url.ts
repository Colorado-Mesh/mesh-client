import { Buffer } from 'buffer';

/**
 * Node's `base64url` encoding (main uses it for sidecar credentials and ids); the browser
 * `buffer` package predates it. Patched on the shared Buffer class the whole bundle imports.
 */
export function installBase64Url(BufferClass: unknown = Buffer): void {
  const B = BufferClass as {
    prototype: { toString: (...a: unknown[]) => string; write: (...a: unknown[]) => number };
    from: (...a: unknown[]) => Buffer;
    byteLength: (...a: unknown[]) => number;
    isEncoding: (e: string) => boolean;
  };
  const toB64 = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/');
  const origToString = B.prototype.toString;
  B.prototype.toString = function (this: Buffer, enc?: unknown, ...rest: unknown[]) {
    if (enc === 'base64url') {
      return origToString
        .call(this, 'base64', ...rest)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    }
    return origToString.call(this, enc, ...rest);
  };
  const origWrite = B.prototype.write;
  B.prototype.write = function (this: Buffer, str: unknown, ...rest: unknown[]) {
    const encIdx = rest.findIndex((r) => r === 'base64url');
    if (encIdx >= 0 && typeof str === 'string') {
      const args = [...rest];
      args[encIdx] = 'base64';
      return origWrite.call(this, toB64(str), ...args);
    }
    return origWrite.call(this, str, ...rest);
  };
  const origFrom = B.from.bind(BufferClass);
  B.from = (value: unknown, enc?: unknown, ...rest: unknown[]) =>
    enc === 'base64url' && typeof value === 'string'
      ? origFrom(toB64(value), 'base64')
      : origFrom(value, enc, ...rest);
  const origByteLength = B.byteLength.bind(BufferClass);
  B.byteLength = (value: unknown, enc?: unknown) =>
    enc === 'base64url' && typeof value === 'string'
      ? origByteLength(toB64(value), 'base64')
      : origByteLength(value, enc);
  const origIsEncoding = B.isEncoding.bind(BufferClass);
  B.isEncoding = (e: string) => e === 'base64url' || origIsEncoding(e);
}
