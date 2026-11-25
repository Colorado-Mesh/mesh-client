/**
 * Post-connect plaintext auth for MeshCom KISS/TCP and NET Console.
 */

import {
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
  { status: 'none' } | { status: 'ok' } | { status: 'rejected'; reason: string };

/**
 * Wait for `OK` / `NONCE:` / timeout. When a nonce arrives and `password` is set,
 * reply with HMAC-SHA256 and require `OK`. Empty password + nonce → rejected.
 * No greeting within the timeout → `{ status: 'none' }` (auth disabled on node).
 */
export async function runMeshcomTcpAuth(
  io: MeshcomTcpAuthIo,
  password: string,
  timeoutMs = MESHCOM_AUTH_GREETING_TIMEOUT_MS,
): Promise<MeshcomTcpAuthResult> {
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
    unsub();
    settle(result);
  };

  const timer = setTimeout(() => {
    finish({ status: 'none' });
  }, timeoutMs);

  let awaitingHmacReply = false;

  const unsub = io.onData((bytes) => {
    if (gate.settled) return;
    void (async () => {
      for (const raw of lineBuf.push(bytes)) {
        if (gate.settled) return;
        const greeting = parseMeshcomAuthGreeting(raw);
        if (greeting.kind === 'ok') {
          finish({ status: 'ok' });
          return;
        }
        if (greeting.kind === 'fail') {
          finish({ status: 'rejected', reason: 'authentication rejected' });
          return;
        }
        if (greeting.kind === 'nonce') {
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
