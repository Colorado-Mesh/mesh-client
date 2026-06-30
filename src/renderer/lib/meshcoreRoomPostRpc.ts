import { MESHCORE_TXT_TYPE_PLAIN } from './meshcoreChannelText';
import { meshcoreRadioErrMessage } from './meshcoreRadioErr';
import {
  computeRoomLoginExtraTimeoutMs,
  computeRoomLoginSentWaitMs,
  type MeshcoreCompanionTransport,
} from './timeConstants';

/** meshcore.js CommandCodes.SendTxtMsg */
const MC_CMD_SEND_TXT_MSG = 2;

/** meshcore.js ResponseCodes */
const MC_RESP_ERR = 1;
const MC_RESP_SENT = 6;

export interface MeshcoreRoomPostRpcConnection {
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
  once(event: string | number, cb: (...args: unknown[]) => void): void;
  sendToRadioFrame(data: Uint8Array): Promise<void>;
}

/** SignedPlain wire body: 4-byte author pubkey prefix + UTF-8 post text. */
export function meshcoreRoomPostWireBytes(authorPubKey: Uint8Array, text: string): Uint8Array {
  if (authorPubKey.length < 4) {
    throw new Error('Room post requires at least 4 bytes of author public key');
  }
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(4 + body.length);
  out.set(authorPubKey.subarray(0, 4), 0);
  out.set(body, 4);
  return out;
}

/** Build SendTxtMsg radio frame (matches meshcore.js sendCommandSendTxtMsg). */
export function buildSendTxtMsgFrame(
  txtType: number,
  attempt: number,
  senderTimestampSec: number,
  contactPublicKey: Uint8Array,
  textUtf8: Uint8Array,
): Uint8Array {
  if (contactPublicKey.length < 6) {
    throw new Error('SendTxtMsg requires at least 6 bytes of contact public key');
  }
  const pub6 = contactPublicKey.subarray(0, 6);
  const frame = new Uint8Array(1 + 1 + 1 + 4 + 6 + textUtf8.length);
  let o = 0;
  frame[o++] = MC_CMD_SEND_TXT_MSG;
  frame[o++] = txtType & 0xff;
  frame[o++] = attempt & 0xff;
  frame[o++] = senderTimestampSec & 0xff;
  frame[o++] = (senderTimestampSec >>> 8) & 0xff;
  frame[o++] = (senderTimestampSec >>> 16) & 0xff;
  frame[o++] = (senderTimestampSec >>> 24) & 0xff;
  frame.set(pub6, o);
  o += 6;
  frame.set(textUtf8, o);
  return frame;
}

export interface MeshcoreRoomPostSentResult {
  expectedAckCrc?: number;
  estTimeout?: number;
}

/**
 * Send a plain-text room BBS post via SendTxtMsg + SENT wait.
 * Companion firmware accepts TXT_TYPE_PLAIN (0) only for outbound SendTxtMsg; SignedPlain is
 * for room-server pushes inbound. Avoids meshcore.js `sendTextMessage` bare reject() on Err.
 *
 * Intentionally not routed through chat reply/tapback helpers (`buildMeshcoreOutboundSendText`,
 * Open wire toggle): room outbound is raw post body only. When extending Rooms (replies,
 * reactions), align UX with Chat but confirm room-server wire before reusing chat prefixes.
 */
export function runMeshcoreRoomPostSend(
  conn: MeshcoreRoomPostRpcConnection,
  contactPublicKey: Uint8Array,
  text: string,
  opts?: { hopsAway?: number; companionTransport?: MeshcoreCompanionTransport },
): Promise<MeshcoreRoomPostSentResult> {
  const wireBytes = new TextEncoder().encode(text);
  const senderTimestampSec = Math.floor(Date.now() / 1000);
  const frame = buildSendTxtMsgFrame(
    MESHCORE_TXT_TYPE_PLAIN,
    0,
    senderTimestampSec,
    contactPublicKey,
    wireBytes,
  );
  const sentWaitMs =
    computeRoomLoginSentWaitMs(opts?.companionTransport ?? 'ble') +
    computeRoomLoginExtraTimeoutMs(opts?.hopsAway);

  return new Promise((resolve, reject) => {
    let settled = false;
    let sentWaitTimer: ReturnType<typeof setTimeout> | undefined;
    let acceptResponses = false;

    const cleanup = (): void => {
      if (sentWaitTimer !== undefined) {
        clearTimeout(sentWaitTimer);
        sentWaitTimer = undefined;
      }
      conn.off(MC_RESP_SENT, onSent);
      conn.off(MC_RESP_ERR, onErr);
    };

    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const succeed = (response: MeshcoreRoomPostSentResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(response);
    };

    const onSent = (response: unknown): void => {
      if (!acceptResponses) return;
      const r = response as { estTimeout?: number; expectedAckCrc?: number };
      succeed({
        expectedAckCrc: r.expectedAckCrc,
        estTimeout: r.estTimeout,
      });
    };

    const onErr = (response: unknown): void => {
      if (!acceptResponses) return;
      const r = response as { errCode?: number | null };
      const errCode = r.errCode ?? null;
      fail(meshcoreRadioErrMessage(errCode));
    };

    conn.once(MC_RESP_SENT, onSent);
    conn.once(MC_RESP_ERR, onErr);

    const startSentWaitTimer = (): void => {
      if (settled || sentWaitTimer !== undefined) return;
      sentWaitTimer = setTimeout(() => {
        fail('Room post timed out waiting for the radio. Check range or try again.');
      }, sentWaitMs);
    };

    void conn
      .sendToRadioFrame(frame)
      .then(() => {
        acceptResponses = true;
        startSentWaitTimer();
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        fail(msg.trim() || 'Room post send failed');
      });
  });
}
