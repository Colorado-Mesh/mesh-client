/**
 * MeshCore DM send helpers: Err-code normalization for meshcore.js bare reject(),
 * and async pubkey resolve (session/registry/store/SQLite/radio contacts).
 */
import type { Connection } from '@liamcottle/meshcore.js';

import { resolveMeshcoreNodePubKey } from '../../hooks/meshcore/meshcoreHookPreamble';
import type { NodeRecord } from '../../stores/nodeStore';
import {
  isMeshcoreNotFoundError,
  MESHCORE_RADIO_ERR_NOT_FOUND,
  MeshcoreRadioRejectedError,
} from '../meshcoreRadioErr';
import { pubkeyToNodeId } from '../meshcoreUtils';
import { tryGetMeshcoreSession } from '../sessions/meshcoreSession';
import { MS_PER_SECOND } from '../timeConstants';
import type { IdentityId } from '../types';
import { registerMeshcorePubKey } from './meshcorePubKeyRegistry';

const RESPONSE_CODE_ERR = 1; // meshcore.js Constants.ResponseCodes.Err

/** Bound wait so a hung send cannot block later calls on the same connection forever. */
const MESHCORE_SEND_ERR_CODE_QUEUE_WAIT_MS = 45 * MS_PER_SECOND;

/** Thrown when a prior send is still in flight after the queue wait bound. */
export const MESHCORE_SEND_PRIOR_IN_FLIGHT =
  'MeshCore send blocked: prior send still in flight on this connection';

const sendErrCodeQueues = new WeakMap<object, Promise<unknown>>();

export interface ResolveMeshcoreDmDestinationPubKeyAsyncOpts {
  /** Live companion — used to scan getContacts when SQLite/maps miss the key. */
  conn?: Connection | null;
}

export async function resolveMeshcoreDmDestinationPubKeyAsync(
  _identityId: IdentityId,
  nodeId: number,
  storeRecord: NodeRecord | undefined,
  opts: ResolveMeshcoreDmDestinationPubKeyAsyncOpts = {},
): Promise<Uint8Array | undefined> {
  const sessionKey = tryGetMeshcoreSession()?.getDestinationPubKey?.(nodeId);
  const map = new Map<number, Uint8Array>();
  if (sessionKey) map.set(nodeId, sessionKey);
  const resolved = await resolveMeshcoreNodePubKey(nodeId, map, storeRecord?.publicKey);
  if (resolved) {
    registerMeshcorePubKey(nodeId, resolved);
    return resolved;
  }

  const conn = opts.conn;
  if (!conn || typeof conn.getContacts !== 'function') return undefined;

  try {
    const contacts = await conn.getContacts();
    const match = Array.isArray(contacts)
      ? contacts.find((c) => {
          const pk = (c as { publicKey?: Uint8Array }).publicKey;
          return pk instanceof Uint8Array && pk.byteLength === 32 && pubkeyToNodeId(pk) === nodeId;
        })
      : undefined;
    const radioKey = (match as { publicKey?: Uint8Array } | undefined)?.publicKey;
    if (radioKey instanceof Uint8Array && radioKey.byteLength === 32) {
      registerMeshcorePubKey(nodeId, radioKey);
      return radioKey;
    }
  } catch {
    // catch-no-log-ok optional radio fallback; sync/DB already missed
  }
  return undefined;
}

async function runExclusivePerConnection<T>(conn: object, work: () => Promise<T>): Promise<T> {
  const prev = sendErrCodeQueues.get(conn) ?? Promise.resolve();
  let priorSettled = false;
  let queueWaitTimedOut = false;
  const prevTracked = prev.finally(() => {
    priorSettled = true;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = prevTracked
    .catch(() => {
      // catch-no-log-ok prior send failure must not block the queue
    })
    .then(() => gate);
  sendErrCodeQueues.set(conn, queued);

  await Promise.race([
    prevTracked,
    new Promise<void>((resolve) => {
      setTimeout(() => {
        queueWaitTimedOut = true;
        resolve();
      }, MESHCORE_SEND_ERR_CODE_QUEUE_WAIT_MS);
    }),
  ]);

  // Queue depth is runtime-dependent; the linter cannot see concurrent sends on one conn.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- prior may outlive the wait bound
  if (queueWaitTimedOut && !priorSettled) {
    // Skipped send: open this gate only after the prior send's queue slot settles so C cannot bypass A.
    void prevTracked.finally(() => {
      release();
    });
    throw new Error(MESHCORE_SEND_PRIOR_IN_FLIGHT);
  }

  try {
    return await work();
  } finally {
    release();
    if (sendErrCodeQueues.get(conn) === queued) {
      sendErrCodeQueues.delete(conn);
    }
  }
}

/**
 * Call companion sendTextMessage, mapping bare reject() + Err payload to MeshcoreRadioRejectedError.
 * Serialized per connection so an Err event can only attach to the active send.
 */
export async function meshcoreSendTextMessageWithErrCode(
  conn: Connection,
  destinationPubKey: Uint8Array,
  text: string,
): Promise<{ expectedAckCrc?: number; estTimeout?: number }> {
  return runExclusivePerConnection(conn, async () => {
    let errCodeFromEvent: number | undefined;
    const onErr = (response: { errCode?: number } | undefined): void => {
      if (response && typeof response.errCode === 'number') {
        errCodeFromEvent = response.errCode;
      }
    };
    conn.once(RESPONSE_CODE_ERR, onErr as (...args: unknown[]) => void);
    try {
      return await conn.sendTextMessage(destinationPubKey, text);
    } catch (e: unknown) {
      if (e === undefined || e === null) {
        throw new MeshcoreRadioRejectedError(
          'MeshCore sendTextMessage rejected',
          errCodeFromEvent ?? MESHCORE_RADIO_ERR_NOT_FOUND,
        );
      }
      if (typeof e === 'object' && 'errCode' in e && typeof e.errCode === 'number') {
        throw new MeshcoreRadioRejectedError('MeshCore sendTextMessage rejected', e.errCode);
      }
      throw e;
    } finally {
      try {
        conn.off(RESPONSE_CODE_ERR, onErr as (...args: unknown[]) => void);
      } catch {
        // catch-no-log-ok listener may already have been removed by once()
      }
    }
  });
}

/** Companion SendTxtMsg with one NOT_FOUND contact restore retry (matches `sendChatOnIdentity`). */
export async function meshcoreSendTextMessageWithNotFoundRestore(
  conn: Connection,
  destinationPubKey: Uint8Array,
  text: string,
  restoreContact: () => Promise<void>,
): Promise<{ expectedAckCrc?: number; estTimeout?: number }> {
  try {
    return await meshcoreSendTextMessageWithErrCode(conn, destinationPubKey, text);
  } catch (e: unknown) {
    if (!isMeshcoreNotFoundError(e)) {
      throw e;
    }
    await restoreContact();
    return await meshcoreSendTextMessageWithErrCode(conn, destinationPubKey, text);
  }
}
