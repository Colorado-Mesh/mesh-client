import {
  MC_RESP_ERR,
  MC_RESP_SENT,
  type MeshcoreRadioConnection,
  normalizePubKeyPrefix,
  prefixToHex,
  pubKeyPrefixesEqual,
  unknownToError,
} from './meshcoreRepeaterRpcCommon';
import {
  type MeshcoreRepeaterRunSerialized,
  runMeshcoreRepeaterQueuedSend,
} from './meshcoreRepeaterRpcQueuedSend';

export interface MeshcoreRepeaterPrefixPushRequestOpts<T> {
  conn: MeshcoreRadioConnection;
  contactPublicKey: Uint8Array;
  extraTimeoutMs: number;
  runSerialized?: MeshcoreRepeaterRunSerialized;
  beforeSend?: () => Promise<void>;
  pushEvent: number;
  /** Optional extra push listeners (e.g. LoginFail while waiting for LoginSuccess). */
  auxiliaryPushEvents?: {
    event: number;
    onMatchedPrefix: (response: unknown) => void;
  }[];
  logTag: string;
  buildFrame: () => Uint8Array;
  parseMatchedPush: (response: unknown) => T;
  rejectSentMessage: string;
  rejectFailureMessage: string;
}

/**
 * Prefix-matched push RPC (Status, Telemetry): resilient listener until prefix matches or timeout.
 */
export function runMeshcoreRepeaterPrefixPushRequest<T>(
  opts: MeshcoreRepeaterPrefixPushRequestOpts<T>,
): Promise<T> {
  const expectedPrefix = opts.contactPublicKey.subarray(0, 6);

  return new Promise((resolve, reject) => {
    let settled = false;
    let responseTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const auxHandlers = new Map<number, (response: unknown) => void>();

    const cleanup = (): void => {
      if (responseTimeoutId !== undefined) {
        clearTimeout(responseTimeoutId);
        responseTimeoutId = undefined;
      }
      opts.conn.off(MC_RESP_SENT, onSent);
      opts.conn.off(MC_RESP_ERR, onErr);
      opts.conn.off(opts.pushEvent, onPush);
      for (const aux of opts.auxiliaryPushEvents ?? []) {
        opts.conn.off(aux.event, auxHandlers.get(aux.event)!);
      }
    };

    const fail = (e: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (e === 'timeout') {
        reject(new Error('timeout'));
        return;
      }
      reject(unknownToError(e, opts.rejectFailureMessage));
    };

    const succeed = (value: T): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const onPush = (response: unknown): void => {
      const r = response as { pubKeyPrefix?: unknown };
      const prefix = normalizePubKeyPrefix(r.pubKeyPrefix);
      if (!prefix) return;
      if (!pubKeyPrefixesEqual(expectedPrefix, prefix)) {
        console.debug(
          `[${opts.logTag}] prefix mismatch expected=${prefixToHex(expectedPrefix)} got=${prefixToHex(prefix)}`,
        );
        return;
      }
      try {
        succeed(opts.parseMatchedPush(response));
      } catch (err) {
        // catch-no-log-ok parse errors propagate via fail() to the RPC caller
        fail(err);
      }
    };

    const armResponseTimeout = (estTimeoutMs: number): void => {
      if (settled) return;
      responseTimeoutId = setTimeout(() => {
        fail('timeout');
      }, estTimeoutMs + opts.extraTimeoutMs);
    };

    const onSent = (response: unknown): void => {
      opts.conn.off(MC_RESP_SENT, onSent);
      opts.conn.off(MC_RESP_ERR, onErr);
      const r = response as { estTimeout?: number };
      armResponseTimeout(r.estTimeout ?? 0);
    };

    const onErr = (): void => {
      fail(new Error(opts.rejectSentMessage));
    };

    opts.conn.on(opts.pushEvent, onPush);

    for (const aux of opts.auxiliaryPushEvents ?? []) {
      const handler = (response: unknown): void => {
        const r = response as { pubKeyPrefix?: unknown };
        const prefix = normalizePubKeyPrefix(r.pubKeyPrefix);
        if (!prefix) return;
        if (!pubKeyPrefixesEqual(expectedPrefix, prefix)) {
          console.debug(
            `[${opts.logTag}] auxiliary prefix mismatch expected=${prefixToHex(expectedPrefix)} got=${prefixToHex(prefix)}`,
          );
          return;
        }
        aux.onMatchedPrefix(response);
      };
      auxHandlers.set(aux.event, handler);
      opts.conn.on(aux.event, handler);
    }

    if (opts.runSerialized) {
      void runMeshcoreRepeaterQueuedSend(
        opts.conn,
        opts.runSerialized,
        () => opts.conn.sendToRadioFrame(opts.buildFrame()),
        opts.beforeSend,
      )
        .then(({ estTimeoutMs }) => {
          if (settled) return;
          armResponseTimeout(estTimeoutMs);
        })
        .catch(fail);
      return;
    }

    opts.conn.on(MC_RESP_SENT, onSent);
    opts.conn.on(MC_RESP_ERR, onErr);

    void opts.conn.sendToRadioFrame(opts.buildFrame()).catch((err: unknown) => {
      fail(err);
    });
  });
}
