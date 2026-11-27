/** `readline` shim: line splitting over a readable stream (used for helper/sidecar stdout). */
import { EventEmitter } from 'events';

export interface LineSource {
  on(event: 'data', l: (chunk: unknown) => void): unknown;
  on(event: 'end' | 'close', l: () => void): unknown;
}

export class Interface extends EventEmitter {
  private buf = '';
  private closed = false;
  constructor(opts: { input: LineSource }) {
    super();
    opts.input.on('data', (chunk: unknown) => {
      this.buf += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk as Uint8Array);
      let i: number;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, '');
        this.buf = this.buf.slice(i + 1);
        this.emit('line', line);
      }
    });
    const end = () => {
      if (this.buf) this.emit('line', this.buf);
      this.buf = '';
      this.close();
    };
    opts.input.on('end', end);
    opts.input.on('close', end);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }
  setPrompt(): void {}
  prompt(): void {}
  write(): void {}
}

export function createInterface(opts: { input: LineSource }): Interface {
  return new Interface(opts);
}
export default { createInterface };
