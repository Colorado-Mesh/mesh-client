import {
  deserializeMeshcoreUserMessage,
  type MeshcoreUserMessage,
  serializeMeshcoreUserMessage,
} from './meshcore/meshcoreMessageI18n';
import { meshcoreRadioErrMessage } from './meshcoreRadioErr';
import { type MeshcoreRoomPostRpcConnection, runMeshcoreRoomPostSend } from './meshcoreRoomPostRpc';
import type { MeshcoreCompanionTransport } from './timeConstants';
import type { DiagnosticTextI18n } from './types';

export type MeshcoreRoomPostSendConn = MeshcoreRoomPostRpcConnection;

function unknownToRoomPostError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === 'string' && e.trim()) return new Error(e);
  return new Error(String(e));
}

function isMeshcoreRoomPostRadioErrKey(msg: string): boolean {
  return msg.startsWith('meshcore.errors.roomPost.');
}

/** Normalize room post send errors for UI and message status storage. */
export function meshcoreRoomPostSendErrorMessage(e: unknown): MeshcoreUserMessage {
  const msg = unknownToRoomPostError(e).message.trim();
  // meshcore.js `sendTextMessage` rejects with no argument on ResponseCodes.Err (message becomes "undefined").
  if (!msg || msg === 'undefined') {
    return { key: 'meshcore.errors.roomPost.default' };
  }
  if (msg === 'timeout') {
    return { key: 'meshcore.errors.roomPost.timeout' };
  }
  if (msg.includes('sendRoomPost timed out')) {
    return { key: 'meshcore.errors.roomPost.timeout' };
  }
  const deserialized = deserializeMeshcoreUserMessage(msg);
  if (typeof deserialized !== 'string') {
    return deserialized;
  }
  if (isMeshcoreRoomPostRadioErrKey(deserialized)) {
    return { key: deserialized };
  }
  return msg;
}

/** Serialize for Error.message / SQLite status fields. */
export function meshcoreRoomPostSendErrorStored(e: unknown): string {
  return serializeMeshcoreUserMessage(meshcoreRoomPostSendErrorMessage(e));
}

export function meshcoreRoomPostRadioErrStored(errCode: number | null | undefined): string {
  const ref: DiagnosticTextI18n = meshcoreRadioErrMessage(errCode);
  return serializeMeshcoreUserMessage(ref);
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
