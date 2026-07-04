import type { MeshcoreRadioConnection } from './meshcoreRepeaterRpcCommon';

export function makePubKey(seed: number): Uint8Array {
  const key = new Uint8Array(32);
  key[0] = seed & 0xff;
  key[1] = (seed >> 8) & 0xff;
  for (let i = 2; i < 32; i++) {
    key[i] = (seed + i) & 0xff;
  }
  return key;
}

export function createMockMeshcoreConn(opts?: { withOnce?: boolean }): MeshcoreRadioConnection & {
  emit: (event: string | number, payload?: unknown) => void;
  sentFrames: Uint8Array[];
} {
  const handlers = new Map<string | number, Set<(...args: unknown[]) => void>>();
  const sentFrames: Uint8Array[] = [];

  const conn = {
    sentFrames,
    on(event: string | number, cb: (...args: unknown[]) => void) {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(cb);
    },
    off(event: string | number, cb: (...args: unknown[]) => void) {
      handlers.get(event)?.delete(cb);
    },
    once(event: string | number, cb: (...args: unknown[]) => void) {
      if (opts?.withOnce === false) {
        conn.on(event, cb);
        return;
      }
      const wrapper = (...args: unknown[]) => {
        conn.off(event, wrapper);
        cb(...args);
      };
      conn.on(event, wrapper);
    },
    sendToRadioFrame(data: Uint8Array) {
      sentFrames.push(data);
      return Promise.resolve();
    },
    emit(event: string | number, payload?: unknown) {
      const set = handlers.get(event);
      if (!set) return;
      for (const cb of [...set]) {
        cb(payload);
      }
    },
  };

  return conn;
}
