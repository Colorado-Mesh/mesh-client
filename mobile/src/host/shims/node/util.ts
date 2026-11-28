/** `util` shim: browserify `util` plus the Node 24 helpers main uses. */
import utilPkg from 'util/util.js';

const base = utilPkg as unknown as Record<string, unknown> & {
  types?: Record<string, unknown>;
  inspect: (v: unknown, o?: unknown) => string;
  format: (...a: unknown[]) => string;
  promisify: (f: unknown) => unknown;
};

function isDeepStrictEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    isDeepStrictEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

const types = {
  ...(base.types ?? {}),
  isUint8Array: (v: unknown) => v instanceof Uint8Array,
  isArrayBuffer: (v: unknown) => v instanceof ArrayBuffer,
  isAnyArrayBuffer: (v: unknown) =>
    v instanceof ArrayBuffer ||
    (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer),
  isArrayBufferView: (v: unknown) => ArrayBuffer.isView(v),
  isTypedArray: (v: unknown) => ArrayBuffer.isView(v) && !(v instanceof DataView),
  isPromise: (v: unknown) => v instanceof Promise,
  isDate: (v: unknown) => v instanceof Date,
  isRegExp: (v: unknown) => v instanceof RegExp,
  isNativeError: (v: unknown) => v instanceof Error,
  isMap: (v: unknown) => v instanceof Map,
  isSet: (v: unknown) => v instanceof Set,
  isProxy: () => false,
};

export const inspect = base.inspect;
export const format = base.format;
export const promisify = base.promisify;
export const callbackify = base.callbackify;
export const inherits = base.inherits;
export const deprecate = (fn: unknown) => fn;
export const debuglog = () => () => {};
export const isDeepStrictEqual_ = isDeepStrictEqual;
export { isDeepStrictEqual, types };
export const TextEncoder = globalThis.TextEncoder;
export const TextDecoder = globalThis.TextDecoder;
export function stripVTControlCharacters(s: string): string {
  return s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, ''); // eslint-disable-line no-control-regex
}
export function styleText(_f: unknown, s: string): string {
  return s;
}
export function toUSVString(s: string): string {
  return s.toWellFormed();
}
export function isArray(v: unknown): boolean {
  return Array.isArray(v);
}
export default {
  ...base,
  types,
  inspect,
  format,
  promisify,
  deprecate,
  debuglog,
  isDeepStrictEqual,
  TextEncoder,
  TextDecoder,
  stripVTControlCharacters,
  styleText,
  toUSVString,
};
