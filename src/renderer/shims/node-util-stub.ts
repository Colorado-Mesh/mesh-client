/**
 * Browser/Electron-renderer stub for Node's `util`.
 * @meshtastic/core 2.6.7 (pulled in transitively by @meshtastic/transport-web-serial)
 * imports `{ formatWithOptions, types }` from "util". Listing "util" as a rollup external
 * emits a bare `import "util"` in the browser bundle which fails at runtime.
 */
export function formatWithOptions(_opts: unknown, ...args: unknown[]): string {
  return args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
}
export const types = {
  isUint8Array: (v: unknown): v is Uint8Array => v instanceof Uint8Array,
};
export default { formatWithOptions, types };
