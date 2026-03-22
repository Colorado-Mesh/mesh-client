/**
 * Browser/Electron-renderer stub for Node's `fs`.
 * `rollupOptions.external: ['fs']` was emitting bare `import "fs"` in the client bundle (runtime error).
 * Emscripten glue in meshcore-decoder only calls fs in the Node path; this satisfies the bundler.
 */
export function readFileSync(): never {
  throw new Error('fs is not available in the renderer');
}
export default { readFileSync };
