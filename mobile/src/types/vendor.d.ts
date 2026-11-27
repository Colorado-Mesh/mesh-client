/** Ambient types for untyped browser polyfill packages used by the mobile host worker. */
declare module 'util/util.js' {
  const util: Record<string, unknown>;
  export default util;
}

declare module 'pako' {
  export function deflate(data: Uint8Array): Uint8Array;
  export function deflateRaw(data: Uint8Array): Uint8Array;
  export function gzip(data: Uint8Array): Uint8Array;
  export function inflate(data: Uint8Array): Uint8Array;
  export function inflateRaw(data: Uint8Array): Uint8Array;
  export function ungzip(data: Uint8Array): Uint8Array;
}
