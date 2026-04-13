/**
 * MeshCore RF path prefix layout (path/trace/advert floods share this header).
 * Mirrors `src/main/meshcore-path-decoder.ts` — keep in sync.
 */

export const MESHCORE_TYPE_MASK = 0x3c;
/** Payload type nibble is in bits 2–5 of header byte 0. */
export const MESHCORE_TYPE_SHIFT = 2;
export const MESHCORE_ROUTE_MASK = 0x03;

export const PAYLOAD_TYPE_PATH = 0x08;
export const PAYLOAD_TYPE_TRACE = 0x09;
/** Header payload-type nibble value for node advertisement (`PAYLOAD_TYPE_ADVERT`). */
export const MESHCORE_PAYLOAD_TYPE_ADVERT_NIBBLE = 4;
/** Align with `@liamcottle/meshcore.js` `Packet.PAYLOAD_TYPE_GRP_TXT` (0x05). */
export const MESHCORE_PAYLOAD_TYPE_GRP_TXT_NIBBLE = 5;

const ROUTE_TYPE_TRANSPORT_FLOOD = 0x00;
const ROUTE_TYPE_TRANSPORT_DIRECT = 0x03;
const TRANSPORT_CODES_SIZE = 4;

/** Route bits 0–1 of the first header byte (see MeshCore `docs/packet_format.md`). */
export type MeshCoreRouteBits = 0 | 1 | 2 | 3;

/**
 * Decode path hashes and return the byte offset where the inner application payload begins
 * (e.g. ADVERT pubkey + name after the path segment).
 */
export function decodeMeshCorePathPrefix(raw: Uint8Array): {
  hops: number;
  pathEndOffset: number;
  path: number[];
  /** Present when route is transport flood (`0x00`) or transport direct (`0x03`): `[scope, returnRegion]` as on-air uint16 LE. */
  transportCodes: readonly [number, number] | null;
} {
  if (raw.length < 2) throw new Error('Packet too short for PATH header');

  const routeType = raw[0] & MESHCORE_ROUTE_MASK;
  const hasTransportCodes =
    routeType === ROUTE_TYPE_TRANSPORT_FLOOD || routeType === ROUTE_TYPE_TRANSPORT_DIRECT;
  let transportCodes: readonly [number, number] | null = null;
  if (hasTransportCodes) {
    if (raw.length < 1 + TRANSPORT_CODES_SIZE) {
      throw new Error('Packet too short for transport codes');
    }
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    transportCodes = [view.getUint16(1, true), view.getUint16(3, true)];
  }
  const pathLengthOffset = 1 + (hasTransportCodes ? TRANSPORT_CODES_SIZE : 0);

  if (raw.length < pathLengthOffset + 1) {
    throw new Error(
      `Packet too short: need path_length at offset ${pathLengthOffset}, but buffer is ${raw.length} bytes`,
    );
  }

  const pathLength = raw[pathLengthOffset] & 0x3f;
  const hashSizeCode = (raw[pathLengthOffset] >> 6) & 0x03;
  const hashSize = hashSizeCode + 1;
  const pathByteLength = pathLength * hashSize;
  const pathStartOffset = pathLengthOffset + 1;
  const pathEndOffset = pathStartOffset + pathByteLength;

  if (raw.length < pathEndOffset) {
    throw new Error(
      `Buffer Underrun: path_length is ${pathLength}, hash_size is ${hashSize} (${pathByteLength} bytes), but only ${raw.length - pathStartOffset} bytes remain.`,
    );
  }

  const path = raw.subarray(pathStartOffset, pathEndOffset);

  return {
    hops: pathLength,
    pathEndOffset,
    path: Array.from(path),
    transportCodes,
  };
}

export function meshCorePayloadTypeNibble(byte0: number): number {
  return (byte0 & MESHCORE_TYPE_MASK) >> MESHCORE_TYPE_SHIFT;
}

export function meshCoreRouteBits(byte0: number): MeshCoreRouteBits {
  return (byte0 & MESHCORE_ROUTE_MASK) as MeshCoreRouteBits;
}

/** Align with `@liamcottle/meshcore.js` `Packet.route_type_string` / RawPacketLogPanel. */
export function meshCoreRouteTypeStringFromByte0(byte0: number): string {
  switch (meshCoreRouteBits(byte0)) {
    case 0:
      return 'TRANSPORT_FLOOD';
    case 1:
      return 'FLOOD';
    case 2:
      return 'DIRECT';
    case 3:
      return 'TRANSPORT_DIRECT';
    default:
      return 'FLOOD';
  }
}

/**
 * Human-readable payload label from header bits 2–5 (align with MeshCore `PAYLOAD_TYPE_*`).
 * When unsure, uses `PAYLOAD_0xN` so the raw log stays stable.
 */
export function meshCorePayloadTypeStringFromByte0(byte0: number): string {
  const t = meshCorePayloadTypeNibble(byte0);
  switch (t) {
    case 0:
      return 'REQ_RESP';
    case 2:
      return 'TXT_MSG';
    case 4:
      return 'ADVERT';
    case MESHCORE_PAYLOAD_TYPE_GRP_TXT_NIBBLE:
      return 'GRP_TXT';
    case 8:
      return 'PATH';
    case 9:
      return 'TRACE';
    default:
      return `PAYLOAD_0x${t.toString(16)}`;
  }
}

export function isMeshCorePathPacketByte0(byte0: number): boolean {
  return meshCorePayloadTypeNibble(byte0) === PAYLOAD_TYPE_PATH;
}

export function isMeshCoreTracePacketByte0(byte0: number): boolean {
  return meshCorePayloadTypeNibble(byte0) === PAYLOAD_TYPE_TRACE;
}

/**
 * True when `decodeMeshCorePathPrefix` succeeds and the header looks like intentional MeshCore RF
 * (not arbitrary bytes that accidentally parse). Used after Meshtastic heuristics miss.
 */
export function shouldClassifyRfPayloadAsMeshCoreFromPathDecode(raw: Uint8Array): boolean {
  let decoded: { hops: number; pathEndOffset: number };
  try {
    decoded = decodeMeshCorePathPrefix(raw);
  } catch {
    return false;
  }
  const nibble = meshCorePayloadTypeNibble(raw[0]);
  const route = raw[0] & MESHCORE_ROUTE_MASK;
  const hasTransportCodes =
    route === ROUTE_TYPE_TRANSPORT_FLOOD || route === ROUTE_TYPE_TRANSPORT_DIRECT;
  if (hasTransportCodes) return true;
  if (decoded.hops > 0) return true;
  if (nibble === 4) return true;
  if (nibble === PAYLOAD_TYPE_PATH || nibble === PAYLOAD_TYPE_TRACE) return true;
  return false;
}
