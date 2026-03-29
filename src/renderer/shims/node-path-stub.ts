/**
 * Browser/Electron-renderer stub for Node's `path`.
 * @meshtastic/core 2.6.7 (pulled in transitively by @meshtastic/transport-web-serial)
 * imports `{ normalize }` from "path". Listing "path" as a rollup external emits a bare
 * `import "path"` in the browser bundle which fails at runtime.
 */
export function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/');
}
export default { normalize };
