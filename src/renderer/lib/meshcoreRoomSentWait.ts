import { type MeshcoreRoomPostRpcConnection, runMeshcoreRoomPostSend } from './meshcoreRoomPostRpc';
import type { MeshcoreCompanionTransport } from './timeConstants';

export type MeshcoreRoomPostSendConn = MeshcoreRoomPostRpcConnection;

function unknownToRoomPostError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === 'string' && e.trim()) return new Error(e);
  return new Error(String(e));
}

/** Normalize room post send errors for UI and message status storage. */
export function meshcoreRoomPostSendErrorMessage(e: unknown): string {
  const msg = unknownToRoomPostError(e).message.trim();
  // meshcore.js `sendTextMessage` rejects with no argument on ResponseCodes.Err (message becomes "undefined").
  if (!msg || msg === 'undefined') {
    return 'Room post rejected by the radio. Log out, log in again, then retry.';
  }
  if (msg === 'timeout') {
    return 'Room post timed out waiting for the radio. Check range or try again.';
  }
  return msg;
}

/**
 * Send a plain-text room BBS post with hop- and transport-scaled SENT wait
 * (SendTxtMsg via sendToRadioFrame; avoids meshcore.js sendTextMessage bare reject()).
 */
export async function sendMeshcoreRoomPostWithSentWait(
  conn: MeshcoreRoomPostSendConn,
  roomPubKey: Uint8Array,
  text: string,
  opts?: { hopsAway?: number; companionTransport?: MeshcoreCompanionTransport },
): Promise<{ expectedAckCrc?: number; estTimeout?: number }> {
  const hopsAway = opts?.hopsAway ?? 0;
  const transport = opts?.companionTransport ?? 'ble';
  try {
    return await runMeshcoreRoomPostSend(conn, roomPubKey, text, {
      hopsAway,
      companionTransport: transport,
    });
  } catch (e: unknown) {
    throw unknownToRoomPostError(e);
  }
}
