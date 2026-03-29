/* eslint-disable @typescript-eslint/no-extraneous-class */
/**
 * Browser/Electron-renderer stub for Node's `stream`.
 * @serialport/stream and @serialport/parser-* import Duplex/Transform transitively
 * via @liamcottle/meshcore.js. These are never instantiated in the renderer (serial
 * I/O happens in the main process over IPC). Listing "stream" as a rollup external
 * emits a bare `import "stream"` in the browser bundle which fails at runtime.
 */
export class Transform {
  constructor() {
    throw new Error('stream.Transform is not available in the renderer');
  }
}
export class Duplex {
  constructor() {
    throw new Error('stream.Duplex is not available in the renderer');
  }
}
export default { Transform, Duplex };
