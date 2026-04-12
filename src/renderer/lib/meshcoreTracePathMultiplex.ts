import { MESHCORE_TRACE_SENT_WAIT_TIMEOUT_MS } from './timeConstants';

/** Same shape as meshcore.js `tracePath` resolve value. */
export interface MeshcoreTracePathResult {
  pathLen: number;
  pathHashes: number[];
  pathSnrs: number[];
  lastSnr: number;
  tag: number;
}

/** Minimal connection surface for multiplexed trace (see meshcore `Connection`). */
export interface MeshcoreTracePathMuxConnection {
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
  once(event: string | number, cb: (...args: unknown[]) => void): void;
  sendCommandSendTracePath(tag: number, auth: number, path: Uint8Array): Promise<void>;
}

interface PendingTrace {
  resolve: (r: MeshcoreTracePathResult) => void;
  reject: (e: unknown) => void;
  traceTimeoutId?: ReturnType<typeof setTimeout>;
}

interface MuxState {
  pendingByTag: Map<number, PendingTrace>;
  onTraceData: (response: Record<string, unknown>) => void;
}

const muxByConn = new WeakMap<object, MuxState>();

/** Mirror `@liamcottle/meshcore.js` `constants.js` ResponseCodes / PushCodes (avoid incomplete .d.ts). */
const MC_RESP_ERR = 1;
const MC_RESP_SENT = 6;
const MC_PUSH_TRACE_DATA = 0x89;

function getMuxState(conn: object): MuxState {
  let s = muxByConn.get(conn);
  if (s) return s;
  const pendingByTag = new Map<number, PendingTrace>();
  const onTraceData = (...args: unknown[]) => {
    const response = args[0] as Record<string, unknown>;

    let tagRaw = response.tag;
    if (typeof tagRaw === 'string') tagRaw = Number(tagRaw);
    if (typeof tagRaw !== 'number' || !Number.isFinite(tagRaw)) {
      return;
    }

    const tagSigned = tagRaw;
    const tagUnsigned = tagRaw >>> 0;

    const p = pendingByTag.get(tagUnsigned) ?? pendingByTag.get(tagSigned);
    if (!p) {
      console.debug(
        '[meshcoreTracePathMultiplex] TraceData with no pending trace, tag=',
        tagUnsigned.toString(16),
      );
      return;
    }

    if (p.traceTimeoutId !== undefined) clearTimeout(p.traceTimeoutId);
    pendingByTag.delete(tagUnsigned);
    pendingByTag.delete(tagSigned);

    try {
      const result = traceDataPayloadToResult(response);
      p.resolve(result);
    } catch (err) {
      // catch-no-log-ok bad TraceData shape; caller gets Error via p.reject
      p.reject(unknownToError(err, 'invalid trace response'));
    }
  };
  (conn as MeshcoreTracePathMuxConnection).on(MC_PUSH_TRACE_DATA, onTraceData);
  s = { pendingByTag, onTraceData };
  muxByConn.set(conn, s);
  return s;
}

function traceDataPayloadToResult(response: Record<string, unknown>): MeshcoreTracePathResult {
  const pathLen = Math.max(0, Math.floor(Number(response.pathLen ?? 0)));

  const getArray = (val: unknown): number[] => {
    if (Array.isArray(val)) return val.map((x) => Number(x) || 0);
    if (val instanceof Uint8Array) return Array.from(val);
    if (val instanceof ArrayBuffer) return Array.from(new Uint8Array(val));
    if (val != null && typeof val === 'object' && 'length' in val) {
      return Array.from(val as ArrayLike<unknown>).map((x) => Number(x) || 0);
    }
    return [];
  };

  let pathHashes = getArray(response.pathHashes);
  let pathSnrsWire = getArray(response.pathSnrs);

  if (pathHashes.length > pathLen) pathHashes = pathHashes.slice(0, pathLen);
  if (pathSnrsWire.length > pathLen + 1) pathSnrsWire = pathSnrsWire.slice(0, pathLen + 1);

  while (pathHashes.length < pathLen) pathHashes.push(0);
  while (pathSnrsWire.length < pathLen + 1) pathSnrsWire.push(0);

  const pathSnrs = pathLen > 0 ? pathSnrsWire.slice(0, pathLen) : [];

  const lastFromResponse = response.lastSnr;
  let lastSnr: number;
  if (typeof lastFromResponse === 'number' && Number.isFinite(lastFromResponse)) {
    lastSnr = lastFromResponse;
  } else if (pathLen > 0 && pathSnrsWire.length > pathLen) {
    lastSnr = (pathSnrsWire[pathLen] & 0xff) / 4;
  } else if (pathSnrsWire.length > 0) {
    lastSnr = (pathSnrsWire[pathSnrsWire.length - 1] & 0xff) / 4;
  } else {
    lastSnr = 0;
  }

  return {
    pathLen,
    pathHashes,
    pathSnrs,
    lastSnr,
    tag: Number(response.tag ?? 0) >>> 0,
  };
}

function randomTraceTag(): number {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return new DataView(b.buffer).getUint32(0, true) >>> 0;
}

function unknownToError(e: unknown, fallback: string): Error {
  if (e instanceof Error) return e;
  if (e === null || e === undefined) return new Error(fallback);
  if (typeof e === 'string') return new Error(e);
  if (typeof e === 'number' || typeof e === 'boolean' || typeof e === 'bigint')
    return new Error(String(e));
  try {
    return new Error(JSON.stringify(e));
  } catch {
    // catch-no-log-ok JSON.stringify throws on circular structures
    return new Error(fallback);
  }
}

/**
 * Start a trace route: one companion `Sent` + `SendTracePath` pair is serialized with other RPCs
 * (via `runSerialized`), while multiple traces can wait for `TraceData` at the same time; responses
 * are matched by the 32-bit tag (same as meshcore.js `tracePath`, but shared `TraceData` listener).
 */
export function runMeshcoreTracePathMultiplexed(
  conn: MeshcoreTracePathMuxConnection,
  path: Uint8Array,
  extraTimeoutMillis: number,
  runSerialized: <T>(fn: () => Promise<T>) => Promise<T>,
): Promise<MeshcoreTracePathResult> {
  return new Promise((resolve, reject) => {
    let tag = randomTraceTag();
    const state = getMuxState(conn as object);
    while (state.pendingByTag.has(tag)) {
      tag = randomTraceTag();
    }

    let settled = false;
    let traceTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      if (traceTimeoutId !== undefined) clearTimeout(traceTimeoutId);
      state.pendingByTag.delete(tag);
      reject(unknownToError(e, 'trace failed'));
    };

    const succeed = (r: MeshcoreTracePathResult) => {
      if (settled) return;
      settled = true;
      if (traceTimeoutId !== undefined) clearTimeout(traceTimeoutId);
      state.pendingByTag.delete(tag);
      resolve(r);
    };

    const pending: PendingTrace = {
      resolve: succeed,
      reject: fail,
    };
    state.pendingByTag.set(tag, pending);

    void runSerialized(async () => {
      try {
        let estTimeoutMs = 0;
        await new Promise<void>((resolveSent, rejectSent) => {
          let sentWaitTimer: ReturnType<typeof setTimeout> | undefined;
          const clearSentWait = () => {
            if (sentWaitTimer !== undefined) {
              clearTimeout(sentWaitTimer);
              sentWaitTimer = undefined;
            }
          };
          const offListeners = () => {
            clearSentWait();
            conn.off(MC_RESP_SENT, onSent);
            conn.off(MC_RESP_ERR, onErr);
          };
          const onSent = (response: unknown) => {
            offListeners();
            const r = response as { estTimeout?: number };
            estTimeoutMs = r.estTimeout ?? 0;
            resolveSent();
          };
          const onErr = () => {
            offListeners();
            rejectSent(new Error('radio rejected trace'));
          };
          sentWaitTimer = setTimeout(() => {
            offListeners();
            rejectSent(new Error('timeout waiting for trace acknowledgment'));
          }, MESHCORE_TRACE_SENT_WAIT_TIMEOUT_MS);
          conn.once(MC_RESP_SENT, onSent);
          conn.once(MC_RESP_ERR, onErr);
          void conn.sendCommandSendTracePath(tag, 0, path).catch((err: unknown) => {
            offListeners();
            rejectSent(unknownToError(err, 'send trace path failed'));
          });
        });

        traceTimeoutId = setTimeout(() => {
          fail(new Error('timeout'));
        }, estTimeoutMs + extraTimeoutMillis);
        pending.traceTimeoutId = traceTimeoutId;
      } catch (e) {
        // catch-no-log-ok trace send/Sent path; fail() rejects the multiplex Promise
        fail(e);
      }
    }).catch(fail);
  });
}
