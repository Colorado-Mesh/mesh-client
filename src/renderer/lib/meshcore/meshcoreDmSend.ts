/**
 * MeshCore DM send helpers: Err-code normalization for meshcore.js bare reject(),
 * and async pubkey resolve (session/registry/store/SQLite/radio contacts).
 */
import type { Connection } from '@liamcottle/meshcore.js';

import { resolveMeshcoreNodePubKey } from '../../hooks/meshcore/meshcoreHookPreamble';
import type { NodeRecord } from '../../stores/nodeStore';
import { MESHCORE_RADIO_ERR_NOT_FOUND, MeshcoreRadioRejectedError } from '../meshcoreRadioErr';
import { pubkeyToNodeId } from '../meshcoreUtils';
import { tryGetMeshcoreSession } from '../sessions/meshcoreSession';
import { MS_PER_SECOND } from '../timeConstants';
import type { IdentityId } from '../types';
import { registerMeshcorePubKey } from './meshcorePubKeyRegistry';

const RESPONSE_CODE_ERR = 1; // meshcore.js Constants.ResponseCodes.Err

/** Bound wait so a hung send cannot block later calls on the same connection forever. */
const MESHCORE_SEND_ERR_CODE_QUEUE_WAIT_MS = 45 * MS_PER_SECOND;

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
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = prev
    .catch(() => {
      // catch-no-log-ok prior send failure must not block the queue
    })
    .then(() => gate);
  sendErrCodeQueues.set(conn, queued);

  const waitBounded = Promise.race([
    prev.catch(() => undefined),
    new Promise<void>((resolve) => {
      setTimeout(resolve, MESHCORE_SEND_ERR_CODE_QUEUE_WAIT_MS);
    }),
  ]);
  await waitBounded;

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
