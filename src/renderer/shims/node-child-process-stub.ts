/**
 * Browser/Electron-renderer stub for Node's `child_process`.
 * @serialport/bindings-cpp imports spawn (Linux port detection) transitively via
 * @liamcottle/meshcore.js. Never called in the renderer (serial I/O goes through IPC).
 * Listing "child_process" as a rollup external emits a bare `import "child_process"`
 * in the browser bundle which fails at runtime.
 */
export function spawn(): never {
  throw new Error('child_process.spawn is not available in the renderer');
}
export function spawnSync(): never {
  throw new Error('child_process.spawnSync is not available in the renderer');
}
export default { spawn, spawnSync };
