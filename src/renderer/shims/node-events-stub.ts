/* eslint-disable @typescript-eslint/no-extraneous-class */
/**
 * Browser/Electron-renderer stub for Node's `events`.
 * @serialport/bindings-cpp imports EventEmitter (poller.js) transitively via
 * @liamcottle/meshcore.js. Never called in the renderer (serial I/O goes through IPC).
 */
export class EventEmitter {
  constructor() {
    throw new Error('events.EventEmitter is not available in the renderer');
  }
}
export default { EventEmitter };
