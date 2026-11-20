/**
 * Companion CMD_SEND_ANON_REQ (57) — tagged BinaryResponse (0x8C) RPCs for
 * repeater regions / owner / basic clock without admin login.
 */

import { runMeshcoreCompanionRequest } from './meshcoreCompanionRequestQueue';
import {
  MC_PUSH_BINARY_RESPONSE,
  type MeshcoreRadioConnection,
  unknownToError,
} from './meshcoreRepeaterRpcCommon';
import {
  type MeshcoreRepeaterRunSerialized,
  runMeshcoreRepeaterQueuedSend,
} from './meshcoreRepeaterRpcQueuedSend';
import { meshcoreTracePingRadioHasNoRoute } from './meshcoreRepeaterTracePath';
import {
  MC_ANON_REQ_TYPE_BASIC,
  MC_ANON_REQ_TYPE_OWNER,
  MC_ANON_REQ_TYPE_REGIONS,
  MC_CMD_SEND_ANON_REQ,
} from './meshcoreWireCodes';
import { MESHCORE_REPEATER_ADMIN_SENT_WAIT_MS, meshcoreRepeaterReplyWaitMs } from './timeConstants';

export type MeshcoreAnonReqSubtype =
  typeof MC_ANON_REQ_TYPE_REGIONS | typeof MC_ANON_REQ_TYPE_OWNER | typeof MC_ANON_REQ_TYPE_BASIC;

export interface MeshcoreAnonRequestOpts {
  hopsAway?: number | null;
  /**
   * Companion contact `outPathLen` when known. `0xFF` / reserved size → refuse before send
   * (avoids flooding). Zero-hop known routes keep {@link buildSendAnonReqFrame} replyPathLen 0.
   */
  radioContactPathLen?: number | null;
  extraTimeoutMs?: number;
  sentWaitTimeoutMs?: number;
}

export interface MeshcoreAnonRegionsParsed {
  clock: number;
  names: string[];
}

export interface MeshcoreAnonOwnerParsed {
  clock: number;
  nodeName: string;
  ownerInfo: string;
}

export interface MeshcoreAnonBasicParsed {
  clock: number;
  features: number;
  isBridge: boolean;
  bridgeKind: 'uart' | 'espnow' | null;
  forwardingDisabled: boolean;
}

/** Feature bit: UART bridge (firmware WITH_RS232_BRIDGE). */
export const MC_ANON_BASIC_FEATURE_BRIDGE_UART = 0x01;
/** Feature bits: ESP-NOW bridge (firmware WITH_ESPNOW_BRIDGE sets 0x03). */
export const MC_ANON_BASIC_FEATURE_BRIDGE_ESPNOW = 0x03;
/** Feature bit: repeater forwarding currently disabled. */
export const MC_ANON_BASIC_FEATURE_FWD_DISABLED = 0x80;

/**
 * Build `[0x39][pubkey:32][subtype][replyPathLen:0]` for a zero-hop anonymous request.
 * Companion generates the request timestamp/tag.
 */
export function buildSendAnonReqFrame(
  publicKey: Uint8Array,
  subtype: MeshcoreAnonReqSubtype,
): Uint8Array {
  if (publicKey.length !== 32) {
    throw new Error('ANON_REQ requires a 32-byte public key');
  }
  const frame = new Uint8Array(1 + 32 + 1 + 1);
  frame[0] = MC_CMD_SEND_ANON_REQ;
  frame.set(publicKey, 1);
  frame[33] = subtype;
  frame[34] = 0; // reply path length 0 (direct / zero-hop)
  return frame;
}

function trimNulPadding(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return bytes.subarray(0, end);
}

function readClockLe(data: Uint8Array, offset = 0): number {
  return new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true);
}

/**
 * BinaryResponse payload: clock(4 LE) + NUL-padded CSV of flood-allowed region names.
 * Drops legacy `*` and empty tokens; preserves case.
 */
export function parseMeshcoreAnonRegionsResponse(data: Uint8Array): MeshcoreAnonRegionsParsed {
  if (data.length < 4) {
    throw new Error('invalid anon regions response');
  }
  const clock = readClockLe(data);
  const csv = new TextDecoder().decode(trimNulPadding(data.subarray(4)));
  const names = csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '*');
  for (const name of names) {
    // Defense: reject non-printable / control so a stolen 0x8C body cannot become UI junk.
    if (/[^\x20-\x7E]/.test(name)) {
      throw new Error('invalid anon regions response');
    }
  }
  return { clock, names };
}

/** BinaryResponse payload: clock(4 LE) + `node_name\\nowner_info` (NUL-padded). */
export function parseMeshcoreAnonOwnerResponse(data: Uint8Array): MeshcoreAnonOwnerParsed {
  if (data.length < 4) {
    throw new Error('invalid anon owner response');
  }
  const clock = readClockLe(data);
  const text = new TextDecoder().decode(trimNulPadding(data.subarray(4)));
  const nl = text.indexOf('\n');
  const nodeName = (nl >= 0 ? text.slice(0, nl) : text).trim();
  const ownerInfo = (nl >= 0 ? text.slice(nl + 1) : '').replace(/\0/g, '');
  return { clock, nodeName, ownerInfo };
}

/** BinaryResponse payload: clock(4 LE) + features(1). */
export function parseMeshcoreAnonBasicResponse(data: Uint8Array): MeshcoreAnonBasicParsed {
  if (data.length < 5) {
    throw new Error('invalid anon basic response');
  }
  const clock = readClockLe(data);
  const features = data[4];
  const bridgeBits = features & 0x03;
  let bridgeKind: MeshcoreAnonBasicParsed['bridgeKind'] = null;
  if (bridgeBits === MC_ANON_BASIC_FEATURE_BRIDGE_ESPNOW) bridgeKind = 'espnow';
  else if (bridgeBits === MC_ANON_BASIC_FEATURE_BRIDGE_UART) bridgeKind = 'uart';
  return {
    clock,
    features,
    isBridge: bridgeKind != null,
    bridgeKind,
    forwardingDisabled: (features & MC_ANON_BASIC_FEATURE_FWD_DISABLED) !== 0,
  };
}

/**
 * Send ANON_REQ and wait for the matching BinaryResponse body.
 *
 * ANON replies often carry BinaryResponse.tag = 0 (unlike SendBinaryReq), so after SENT we
 * accept the first 0x8C when the expected tag is missing/zero, or when the push tag is 0.
 * Companion request serialization prevents cross-talk with other 0x8C consumers.
 */
export function runMeshcoreAnonRequest(
  conn: MeshcoreRadioConnection,
  contactPublicKey: Uint8Array,
  subtype: MeshcoreAnonReqSubtype,
  extraTimeoutMsOrOpts: number | MeshcoreAnonRequestOpts,
  runSerialized: MeshcoreRepeaterRunSerialized,
  beforeSend?: () => Promise<void>,
): Promise<Uint8Array> {
  const opts: MeshcoreAnonRequestOpts =
    typeof extraTimeoutMsOrOpts === 'number'
      ? { extraTimeoutMs: extraTimeoutMsOrOpts }
      : extraTimeoutMsOrOpts;
  return runMeshcoreCompanionRequest(conn, () =>
    performAnonRequest(conn, contactPublicKey, subtype, opts, runSerialized, beforeSend),
  );
}

function performAnonRequest(
  conn: MeshcoreRadioConnection,
  contactPublicKey: Uint8Array,
  subtype: MeshcoreAnonReqSubtype,
  opts: MeshcoreAnonRequestOpts,
  runSerialized: MeshcoreRepeaterRunSerialized,
  beforeSend?: () => Promise<void>,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let sentArmed = false;
    let expectedTag: number | null = null;
    let responseTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const useReceiptDerived = typeof opts.hopsAway === 'number';
    const sentWaitMs = opts.sentWaitTimeoutMs ?? MESHCORE_REPEATER_ADMIN_SENT_WAIT_MS;

    const cleanup = (): void => {
      if (responseTimeoutId !== undefined) {
        clearTimeout(responseTimeoutId);
        responseTimeoutId = undefined;
      }
      conn.off(MC_PUSH_BINARY_RESPONSE, onBinaryResponsePush);
    };

    const fail = (e: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (e === 'timeout') {
        reject(new Error('timeout'));
        return;
      }
      reject(unknownToError(e, 'anon request failed'));
    };

    const succeed = (responseData: Uint8Array): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(responseData);
    };

    const onBinaryResponsePush = (response: unknown): void => {
      if (!sentArmed) return;
      const r = response as { tag?: number; responseData?: Uint8Array };
      const tag = (r.tag ?? 0) >>> 0;
      // Match when we have a non-zero expected tag; also accept tag=0 (ANON quirk) or
      // missing expectedAckCrc (accept first 0x8C after SENT under companion lock).
      if (expectedTag != null && expectedTag !== 0 && tag !== 0 && tag !== expectedTag) {
        return;
      }
      const responseData = r.responseData;
      if (!(responseData instanceof Uint8Array)) {
        fail(new Error('invalid anon response payload'));
        return;
      }
      succeed(responseData);
    };

    conn.on(MC_PUSH_BINARY_RESPONSE, onBinaryResponsePush);

    const armResponseWait = (estTimeoutMs: number, expectedAckCrc: number | undefined): void => {
      expectedTag =
        expectedAckCrc != null && Number.isFinite(expectedAckCrc) ? expectedAckCrc >>> 0 : null;
      sentArmed = true;
      const waitMs = useReceiptDerived
        ? meshcoreRepeaterReplyWaitMs({ estTimeoutMs, hopsAway: opts.hopsAway })
        : (() => {
            const legacy = estTimeoutMs + (opts.extraTimeoutMs ?? 0);
            return legacy > 0
              ? legacy
              : meshcoreRepeaterReplyWaitMs({ estTimeoutMs, hopsAway: opts.hopsAway });
          })();
      responseTimeoutId = setTimeout(() => {
        fail('timeout');
      }, waitMs);
    };

    // Unknown outbound path (0xFF) would flood — refuse before TX. Known zero-hop keeps frame[34]=0.
    if (meshcoreTracePingRadioHasNoRoute(opts.radioContactPathLen)) {
      fail(new Error('anon request sent as flood'));
      return;
    }

    void runMeshcoreRepeaterQueuedSend(
      conn,
      runSerialized,
      () => conn.sendToRadioFrame(buildSendAnonReqFrame(contactPublicKey, subtype)),
      beforeSend,
      ({ estTimeoutMs, expectedAckCrc, sentAsFlood }) => {
        if (sentAsFlood) {
          fail(new Error('anon request sent as flood'));
          return;
        }
        armResponseWait(estTimeoutMs, expectedAckCrc);
      },
      { timeoutMs: sentWaitMs },
    ).catch(fail);
  });
}

export function runMeshcoreAnonRegionsRequest(
  conn: MeshcoreRadioConnection,
  contactPublicKey: Uint8Array,
  opts: number | MeshcoreAnonRequestOpts,
  runSerialized: MeshcoreRepeaterRunSerialized,
  beforeSend?: () => Promise<void>,
): Promise<MeshcoreAnonRegionsParsed> {
  return runMeshcoreAnonRequest(
    conn,
    contactPublicKey,
    MC_ANON_REQ_TYPE_REGIONS,
    opts,
    runSerialized,
    beforeSend,
  ).then(parseMeshcoreAnonRegionsResponse);
}

export function runMeshcoreAnonOwnerRequest(
  conn: MeshcoreRadioConnection,
  contactPublicKey: Uint8Array,
  opts: number | MeshcoreAnonRequestOpts,
  runSerialized: MeshcoreRepeaterRunSerialized,
  beforeSend?: () => Promise<void>,
): Promise<MeshcoreAnonOwnerParsed> {
  return runMeshcoreAnonRequest(
    conn,
    contactPublicKey,
    MC_ANON_REQ_TYPE_OWNER,
    opts,
    runSerialized,
    beforeSend,
  ).then(parseMeshcoreAnonOwnerResponse);
}

export function runMeshcoreAnonBasicRequest(
  conn: MeshcoreRadioConnection,
  contactPublicKey: Uint8Array,
  opts: number | MeshcoreAnonRequestOpts,
  runSerialized: MeshcoreRepeaterRunSerialized,
  beforeSend?: () => Promise<void>,
): Promise<MeshcoreAnonBasicParsed> {
  return runMeshcoreAnonRequest(
    conn,
    contactPublicKey,
    MC_ANON_REQ_TYPE_BASIC,
    opts,
    runSerialized,
    beforeSend,
  ).then(parseMeshcoreAnonBasicResponse);
}
