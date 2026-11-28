/** `worker_threads` shim: the mobile host does not start Node worker threads. */
import { EventEmitter } from 'events';

export const isMainThread = true;
export const parentPort = null;
export const workerData = null;
export const threadId = 0;
export class Worker extends EventEmitter {
  constructor(file: unknown) {
    super();
    queueMicrotask(() =>
      this.emit('error', new Error(`Worker threads are not available on mobile (${String(file)})`)),
    );
  }
  postMessage(): void {}
  terminate(): Promise<number> {
    return Promise.resolve(1);
  }
}
export class MessageChannel {
  port1 = new EventEmitter();
  port2 = new EventEmitter();
}
export default { isMainThread, parentPort, workerData, threadId, Worker, MessageChannel };
