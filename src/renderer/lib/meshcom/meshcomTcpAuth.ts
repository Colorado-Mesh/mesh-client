/**
 * Post-connect plaintext auth for MeshCom KISS/TCP and NET Console.
 */

import {
  concatMeshcomAuthLeftover,
  MESHCOM_AUTH_GREETING_TIMEOUT_MS,
  meshcomAuthHmacHex,
  MeshcomAuthLineBuffer,
  parseMeshcomAuthGreeting,
} from './meshcomHmacAuth';

export interface MeshcomTcpAuthIo {
  /** Write UTF-8 bytes to the socket. */
  write(bytes: Uint8Array): Promise<void>;
  /**
   * Subscribe to inbound chunks during the auth phase.
   * Returns an unsubscribe function.
   */
  onData(handler: (bytes: Uint8Array) => void): () => void;
}

export type MeshcomTcpAuthResult =
  | { status: 'none' }
  | { status: 'ok'; leftover: Uint8Array }
  | { status: 'rejected'; reason: string };

export interface RunMeshcomTcpAuthOptions {
  timeoutMs?: number;
  /** Abort (e.g. TCP disconnect mid-handshake) → rejected. */
  signal?: AbortSignal;
}

/**
 * Wait for `OK` / `NONCE:` / timeout. When a nonce arrives and `password` is set,
 * reply with HMAC-SHA256 and require `OK`. Empty password + nonce → rejected.
 * No greeting within the timeout → `{ status: 'none' }` (auth disabled on node).
 * Timeout after a NONCE without OK → rejected (do not treat as open access).
 * Bytes after the OK line are returned as raw `leftover` for the transport to queue.
 */
export async function runMeshcomTcpAuth(
  io: MeshcomTcpAuthIo,
  password: string,
  timeoutMsOrOpts: number | RunMeshcomTcpAuthOptions = MESHCOM_AUTH_GREETING_TIMEOUT_MS,
): Promise<MeshcomTcpAuthResult> {
  const opts: RunMeshcomTcpAuthOptions =
    typeof timeoutMsOrOpts === 'number' ? { timeoutMs: timeoutMsOrOpts } : timeoutMsOrOpts;
  const timeoutMs = opts.timeoutMs ?? MESHCOM_AUTH_GREETING_TIMEOUT_MS;
  const signal = opts.signal;

  const lineBuf = new MeshcomAuthLineBuffer();
  let settle!: (result: MeshcomTcpAuthResult) => void;
  const done = new Promise<MeshcomTcpAuthResult>((resolve) => {
    settle = resolve;
  });
  // Object so TS does not narrow `settled` across the async HMAC await.
  const gate = { settled: false };
  const finish = (result: MeshcomTcpAuthResult) => {
    if (gate.settled) return;
    gate.settled = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    unsub();
    settle(result);
  };

  const onAbort = (): void => {
    finish({ status: 'rejected', reason: 'disconnected during authentication' });
  };
  if (signal) {
    if (signal.aborted) {
      return { status: 'rejected', reason: 'disconnected during authentication' };
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  let sawNonce = false;
  let awaitingHmacReply = false;

  const timer = setTimeout(() => {
    if (sawNonce || awaitingHmacReply) {
      finish({
        status: 'rejected',
        reason: 'authentication timed out waiting for OK',
      });
      return;
    }
    finish({ status: 'none' });
  }, timeoutMs);

  const unsub = io.onData((bytes) => {
    if (gate.settled) return;
    void (async () => {
      const lines = lineBuf.push(bytes);
      for (let i = 0; i < lines.length; i++) {
        if (gate.settled) return;
        const entry = lines[i];
        const greeting = parseMeshcomAuthGreeting(entry.text);
        if (greeting.kind === 'ok') {
          const after: Uint8Array[] = [];
          for (let j = i + 1; j < lines.length; j++) {
            after.push(lines[j].rawWithNl);
          }
          after.push(lineBuf.takeRemainder());
          finish({ status: 'ok', leftover: concatMeshcomAuthLeftover(after) });
          return;
        }
        if (greeting.kind === 'fail') {
          finish({ status: 'rejected', reason: 'authentication rejected' });
          return;
        }
        if (greeting.kind === 'nonce') {
          sawNonce = true;
          if (!password) {
            finish({
              status: 'rejected',
              reason: 'node requires password (--passwd) for KISS/NET Console auth',
            });
            return;
          }
          if (awaitingHmacReply) continue;
          awaitingHmacReply = true;
          try {
            const hex = await meshcomAuthHmacHex(password, greeting.nonceHex);
            await io.write(new TextEncoder().encode(`${hex}\n`));
          } catch (err) {
            console.debug(
              '[meshcomTcpAuth] HMAC reply failed ' +
                (err instanceof Error ? err.message : String(err)),
            );
            finish({
              status: 'rejected',
              reason: err instanceof Error ? err.message : String(err),
            });
            return;
          }
          continue;
        }
        // Banner / unknown lines: keep waiting for NONCE or OK until timeout.
      }
    })();
  });

  return done;
}
