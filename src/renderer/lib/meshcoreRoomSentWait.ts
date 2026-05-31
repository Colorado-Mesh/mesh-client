import { MESHCORE_TXT_TYPE_SIGNED_PLAIN } from './meshcoreChannelText';
import {
  computeRoomLoginExtraTimeoutMs,
  computeRoomLoginSentWaitMs,
  type MeshcoreCompanionTransport,
} from './timeConstants';

export interface MeshcoreRoomPostSendConn {
  sendTextMessage(
    pubKey: Uint8Array,
    text: string,
    type?: number,
  ): Promise<{ expectedAckCrc?: number; estTimeout?: number }>;
}

function unknownToRoomPostError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === 'string' && e.trim()) return new Error(e);
  return new Error(String(e));
}

/** Normalize room post send errors for UI and message status storage. */
export function meshcoreRoomPostSendErrorMessage(e: unknown): string {
  return unknownToRoomPostError(e).message;
}

/**
 * Send a SignedPlain room BBS post with hop- and transport-scaled SENT wait
 * (longer than meshcore.js default on multi-hop BLE paths).
 */
export async function sendMeshcoreRoomPostWithSentWait(
  conn: MeshcoreRoomPostSendConn,
  pubKey: Uint8Array,
  wireText: string,
  opts?: { hopsAway?: number; companionTransport?: MeshcoreCompanionTransport },
): Promise<{ expectedAckCrc?: number; estTimeout?: number }> {
  const hopsAway = opts?.hopsAway ?? 0;
  const transport = opts?.companionTransport ?? 'ble';
  const totalCapMs =
    computeRoomLoginSentWaitMs(transport) + computeRoomLoginExtraTimeoutMs(hopsAway);

  try {
    return await Promise.race([
      conn.sendTextMessage(pubKey, wireText, MESHCORE_TXT_TYPE_SIGNED_PLAIN),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('timeout'));
        }, totalCapMs);
      }),
    ]);
  } catch (e: unknown) {
    throw unknownToRoomPostError(e);
  }
}
