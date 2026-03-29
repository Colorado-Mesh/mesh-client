/**
 * Browser/Electron-renderer stub for Node's `os`.
 * @meshtastic/core 2.6.7 (pulled in transitively by @meshtastic/transport-web-serial)
 * imports `{ hostname }` from "os". Listing "os" as a rollup external emits a bare
 * `import "os"` in the browser bundle which fails at runtime.
 */
export function hostname(): string {
  return '';
}
export default { hostname };
