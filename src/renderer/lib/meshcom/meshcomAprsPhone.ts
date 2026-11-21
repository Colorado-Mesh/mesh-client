/**
 * MeshCom phone/BLE APRS frame decode (firmware `decodeAPRS` in aprs_functions.cpp).
 *
 * BLE framing prepends `0x40` (`@`); callers pass the bytes *after* that tag.
 * Payload types: `:` text, `!` position, `@` special (e.g. HN), `A` (0x41) ACK.
 */

import { resolveMeshcomDestination } from './meshcomChannel';
import { parseAprsUncompressedPosition } from './meshcomKissCodec';

export interface MeshcomAprsPhoneText {
  kind: 'text';
  msgId: number;
  maxHop: number;
  viaServer: boolean;
  sourcePath: string;
  sourceCall: string;
  destCall: string;
  channelIndex: number;
  text: string;
  hwId?: number;
  hopCount: number;
}

export interface MeshcomAprsPhonePosition {
  kind: 'position';
  msgId: number;
  maxHop: number;
  sourcePath: string;
  sourceCall: string;
  latitude: number;
  longitude: number;
  altitudeM?: number;
  batteryPercent?: number;
  comment: string;
  hwId?: number;
  hopCount: number;
}

export interface MeshcomAprsPhoneAck {
  kind: 'ack';
  /** ACK frame's own id (wire LoRa relay) or same as ackMsgId (phone BLE). */
  msgId: number;
  /** Wire LoRa: hop byte at [5]. Phone BLE: status (0x00 heard … 0x02 peer). */
  flags: number;
  /** Quittiert message id — bytes [6..9] on wire, [1..4] on phone BLE. */
  ackMsgId: number;
  ackType: number;
  /** Phone BLE attribution callsign when appendix present (`ack_attribution.h`). */
  attributionCall?: string;
}

export type MeshcomAprsPhoneParse =
  MeshcomAprsPhoneText | MeshcomAprsPhonePosition | MeshcomAprsPhoneAck | { kind: 'unknown' };

function readU32Le(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0
  );
}

function pathHopCount(sourcePath: string): number {
  const parts = sourcePath
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return Math.max(0, parts.length - 1);
}

function sourceCallFromPath(sourcePath: string): string {
  const first = sourcePath.split(',')[0]?.trim() ?? '';
  return first;
}

/**
 * Decode one phone APRS frame (bytes after optional BLE `@` tag).
 */
export function parseMeshcomAprsPhoneFrame(raw: Uint8Array): MeshcomAprsPhoneParse {
  if (raw.length < 1) return { kind: 'unknown' };

  if (raw[0] === 0x41) {
    // LoRa wire (12 B): 0x41 | frame id | 0x80|hops | acked msg id | … (`ack_functions.h`)
    if (raw.length >= 12 && (raw[5] & 0x80) !== 0) {
      return {
        kind: 'ack',
        msgId: readU32Le(raw, 1),
        flags: raw[5],
        ackMsgId: readU32Le(raw, 6),
        ackType: raw[10],
      };
    }
    // Phone BLE (`buildAckPhoneFrame` in `ack_attribution.h`): acked msg id at [1..4], status [5].
    if (raw.length >= 7) {
      const ackMsgId = readU32Le(raw, 1);
      const status = raw[5];
      const appendixLen = raw[6];
      let attributionCall: string | undefined;
      if (appendixLen > 0 && raw.length >= 7 + appendixLen) {
        attributionCall = new TextDecoder('utf-8', { fatal: false }).decode(
          raw.subarray(7, 7 + appendixLen),
        );
      }
      return {
        kind: 'ack',
        msgId: ackMsgId,
        flags: status,
        ackMsgId,
        ackType: status,
        attributionCall,
      };
    }
    return { kind: 'unknown' };
  }

  const payloadType = raw[0];
  if (payloadType !== 0x3a && payloadType !== 0x21 && payloadType !== 0x40) {
    return { kind: 'unknown' };
  }
  if (raw.length < 16) return { kind: 'unknown' };

  const msgId = readU32Le(raw, 1);
  const hopByte = raw[5];
  const maxHop = hopByte & 0x0f;
  const viaServer = (hopByte & 0x80) === 0x80;

  // Source path until '>'
  let i = 6;
  const sourceChars: number[] = [];
  let sourceEnd = false;
  while (i < raw.length && i - 6 < 120) {
    const b = raw[i];
    if (b === 0x3e /* > */) {
      sourceEnd = true;
      i += 1;
      break;
    }
    if (b < 0x20 || b > 0x7e) break;
    sourceChars.push(b);
    i += 1;
  }
  if (!sourceEnd) return { kind: 'unknown' };
  const sourcePath = String.fromCharCode(...sourceChars);
  const sourceCall = sourceCallFromPath(sourcePath);
  if (!sourceCall) return { kind: 'unknown' };

  // Destination until second payload_type
  const destChars: number[] = [];
  let destEnd = false;
  const destStart = i;
  while (i < raw.length && i - destStart < 120) {
    const b = raw[i];
    if (b === payloadType) {
      destEnd = true;
      i += 1;
      break;
    }
    if (b < 0x20 || b > 0x7e) break;
    destChars.push(b);
    i += 1;
  }
  if (!destEnd) return { kind: 'unknown' };
  const destPath = String.fromCharCode(...destChars);
  const destCall = destPath.includes(',')
    ? (destPath.split(',').at(-1)?.trim() ?? destPath)
    : destPath.trim();

  // Payload until 0x00
  const payloadChars: number[] = [];
  let payloadEnd = false;
  while (i < raw.length) {
    const b = raw[i];
    if (b === 0x00) {
      payloadEnd = true;
      i += 1;
      break;
    }
    payloadChars.push(b);
    i += 1;
  }
  if (!payloadEnd) return { kind: 'unknown' };
  const payloadText = new TextDecoder('utf-8', { fatal: false }).decode(
    new Uint8Array(payloadChars),
  );

  const hwId = i < raw.length ? raw[i] : undefined;
  const hopCount = pathHopCount(sourcePath);
  const destResolved = resolveMeshcomDestination(destCall);

  if (payloadType === 0x21 /* ! */) {
    const pos = parseAprsUncompressedPosition(payloadText);
    if (!pos) return { kind: 'unknown' };
    const batteryMatch = /\/B=(\d{1,3})/.exec(pos.comment);
    const altMatch = /\/A=(\d{1,6})/.exec(pos.comment);
    const altitudeFt = altMatch?.[1] != null ? Number.parseInt(altMatch[1], 10) : undefined;
    return {
      kind: 'position',
      msgId,
      maxHop,
      sourcePath,
      sourceCall,
      latitude: pos.latitude,
      longitude: pos.longitude,
      altitudeM:
        altitudeFt != null && Number.isFinite(altitudeFt)
          ? Math.round(altitudeFt * 0.3048)
          : undefined,
      batteryPercent: batteryMatch?.[1] != null ? Number.parseInt(batteryMatch[1], 10) : undefined,
      comment: pos.comment,
      hwId,
      hopCount,
    };
  }

  // Text (':') and special ('@') — treat payload as UTF-8 chat when destination is chat-like.
  if (payloadType === 0x40 && destCall === 'HN') {
    return { kind: 'unknown' };
  }

  return {
    kind: 'text',
    msgId,
    maxHop,
    viaServer,
    sourcePath,
    sourceCall,
    destCall: destResolved.wireDest,
    channelIndex: destResolved.channelIndex,
    text: payloadText,
    hwId,
    hopCount,
  };
}
