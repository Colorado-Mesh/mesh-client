/**
 * Single in-house parse path for MeshCore on-air RF payloads (header + path + inner body).
 * Field layout informed by MeshCore docs and meshcore-decoder (reference only).
 */

import {
  decodeMeshCorePathPrefix,
  MESHCORE_PAYLOAD_TYPE_ADVERT_NIBBLE,
  MESHCORE_TYPE_MASK,
  MESHCORE_TYPE_SHIFT,
  meshCorePayloadTypeNibble,
  meshCorePayloadTypeStringFromByte0,
  meshCoreRouteTypeStringFromByte0,
} from './meshcoreRfPath';

/** CRC-32 (IEEE); used as a stable 8-hex packet fingerprint for UI/DB. */
export function meshCorePacketFingerprintHex(raw: Uint8Array): string {
  let crc = 0xffffffff;
  for (const byte of raw) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

export interface MeshCoreAdvertParsed {
  publicKey: Uint8Array;
  timestampSec: number;
  signature: Uint8Array;
  flags: number;
  deviceRole: number;
  hasLocation: boolean;
  hasName: boolean;
  latitudeDeg: number | null;
  longitudeDeg: number | null;
  name: string;
}

export interface MeshCorePacketSegment {
  name: string;
  startByte: number;
  endByte: number;
  valueHex?: string;
  description?: string;
}

export interface MeshCoreStructureAnalysis {
  messageFingerprintHex: string;
  routeTypeString: string;
  payloadTypeString: string;
  transportCodes: readonly [number, number] | null;
  segments: MeshCorePacketSegment[];
  payloadSegments: MeshCorePacketSegment[];
}

export interface MeshCoreRfParseOk {
  ok: true;
  routeTypeString: string;
  payloadTypeString: string;
  payloadTypeNibble: number;
  hopCount: number;
  pathEndOffset: number;
  /** Inner application payload bytes (after path hashes). */
  innerPayload: Uint8Array;
  pathBytes: number[];
  transportCodes: readonly [number, number] | null;
  messageFingerprintHex: string;
  advert: MeshCoreAdvertParsed | null;
  structure: MeshCoreStructureAnalysis;
}

export interface MeshCoreRfParseFail {
  ok: false;
  reason: string;
}

export type MeshCoreRfParseResult = MeshCoreRfParseOk | MeshCoreRfParseFail;

function readU32LE(u8: Uint8Array, offset: number): number {
  if (offset + 4 > u8.length) return 0;
  const v = new DataView(u8.buffer, u8.byteOffset + offset, 4);
  return v.getUint32(0, true);
}

function readF32LE(u8: Uint8Array, offset: number): number | null {
  if (offset + 4 > u8.length) return null;
  const v = new DataView(u8.buffer, u8.byteOffset + offset, 4);
  return v.getFloat32(0, true);
}

function utf8Slice(u8: Uint8Array, start: number): string {
  if (start >= u8.length) return '';
  const sub = u8.subarray(start);
  try {
    const s = new TextDecoder('utf-8', { fatal: false }).decode(sub);
    return s.replace(/\0+$/g, '').trim();
  } catch {
    return '';
  }
}

/**
 * Parse ADVERT inner payload starting at `inner` (first byte = pubkey start).
 * Layout: pubkey 32, timestamp LE 4, signature 64, flags 1, optional lat/lon f32 LE, name UTF-8.
 */
export function parseMeshCoreAdvertInner(inner: Uint8Array): MeshCoreAdvertParsed | null {
  const minCore = 32 + 4 + 64 + 1;
  if (inner.length < minCore) return null;

  const publicKey = inner.subarray(0, 32);
  const timestampSec = readU32LE(inner, 32);
  const signature = inner.subarray(36, 100);
  const flags = inner[100];
  const deviceRole = flags & 0x0f;
  const hasLocation = ((flags >> 4) & 1) === 1;
  const hasName = ((flags >> 7) & 1) === 1;

  let o = 101;
  let latitudeDeg: number | null = null;
  let longitudeDeg: number | null = null;
  if (hasLocation) {
    const la = readF32LE(inner, o);
    const lo = readF32LE(inner, o + 4);
    o += 8;
    latitudeDeg = la != null && Number.isFinite(la) ? la : null;
    longitudeDeg = lo != null && Number.isFinite(lo) ? lo : null;
  }

  let name = '';
  if (hasName && o < inner.length) {
    name = utf8Slice(inner, o);
  }

  return {
    publicKey,
    timestampSec,
    signature,
    flags,
    deviceRole,
    hasLocation,
    hasName,
    latitudeDeg,
    longitudeDeg,
    name,
  };
}

function buildStructure(
  raw: Uint8Array,
  pathEndOffset: number,
  transportCodes: readonly [number, number] | null,
): MeshCoreStructureAnalysis {
  const byte0 = raw[0];
  const routeTypeString = meshCoreRouteTypeStringFromByte0(byte0);
  const payloadTypeString = meshCorePayloadTypeStringFromByte0(byte0);
  const segments: MeshCorePacketSegment[] = [
    { name: 'Header', startByte: 0, endByte: 0, valueHex: byte0.toString(16).padStart(2, '0') },
  ];
  let o = 1;
  if (transportCodes) {
    segments.push({
      name: 'Transport scope',
      startByte: 1,
      endByte: 2,
      valueHex: transportCodes[0].toString(16).padStart(4, '0'),
      description: `uint16 LE = ${transportCodes[0]}`,
    });
    segments.push({
      name: 'Transport return',
      startByte: 3,
      endByte: 4,
      valueHex: transportCodes[1].toString(16).padStart(4, '0'),
      description: `uint16 LE = ${transportCodes[1]}`,
    });
    o = 5;
  }
  segments.push({
    name: 'Path length + hash size',
    startByte: o,
    endByte: o,
    valueHex: raw[o].toString(16).padStart(2, '0'),
  });
  segments.push({
    name: 'Path hashes',
    startByte: o + 1,
    endByte: pathEndOffset - 1,
  });
  segments.push({
    name: 'Inner payload',
    startByte: pathEndOffset,
    endByte: Math.max(pathEndOffset, raw.length - 1),
  });

  const payloadSegments: MeshCorePacketSegment[] = [];
  const inner = raw.subarray(pathEndOffset);
  if (inner.length > 0) {
    payloadSegments.push({
      name: 'Payload bytes',
      startByte: pathEndOffset,
      endByte: raw.length - 1,
      valueHex: '',
      description: `${inner.length} bytes`,
    });
  }

  return {
    messageFingerprintHex: meshCorePacketFingerprintHex(raw),
    routeTypeString,
    payloadTypeString,
    transportCodes,
    segments,
    payloadSegments,
  };
}

/**
 * Full parse of a captured MeshCore RF payload. Does not throw; returns `{ ok: false }` on failure.
 */
export function parseMeshCoreRfPacket(raw: Uint8Array): MeshCoreRfParseResult {
  if (raw.length < 2) {
    return { ok: false, reason: 'buffer too short' };
  }

  let path: {
    hops: number;
    pathEndOffset: number;
    path: number[];
    transportCodes: readonly [number, number] | null;
  };
  try {
    path = decodeMeshCorePathPrefix(raw);
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  const byte0 = raw[0];
  const routeTypeString = meshCoreRouteTypeStringFromByte0(byte0);
  const payloadTypeString = meshCorePayloadTypeStringFromByte0(byte0);
  const payloadTypeNibble = meshCorePayloadTypeNibble(byte0);
  const inner = raw.subarray(path.pathEndOffset);

  let advert: MeshCoreAdvertParsed | null = null;
  if (payloadTypeNibble === MESHCORE_PAYLOAD_TYPE_ADVERT_NIBBLE && inner.length > 0) {
    advert = parseMeshCoreAdvertInner(inner);
  }

  const structure = buildStructure(raw, path.pathEndOffset, path.transportCodes);

  return {
    ok: true,
    routeTypeString,
    payloadTypeString,
    payloadTypeNibble,
    hopCount: path.hops,
    pathEndOffset: path.pathEndOffset,
    innerPayload: inner,
    pathBytes: path.path,
    transportCodes: path.transportCodes,
    messageFingerprintHex: structure.messageFingerprintHex,
    advert,
    structure,
  };
}

/** First 16 bytes of SHA-256(regionName UTF-8), for transport/region tooling. */
export async function meshCoreRegionKeyFromName(regionName: string): Promise<Uint8Array> {
  const enc = new TextEncoder().encode(regionName);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return new Uint8Array(digest).subarray(0, 16);
}

/**
 * Transport code for a named region: first 2 bytes of HMAC-SHA256(regionKey, payloadTypeByte || payloadBytes) as LE uint16.
 * Aligns with common MeshCore repeater region matching (see meshcore-decoder README).
 */
export async function meshCoreTransportCodeForRegion(
  regionName: string,
  payloadTypeNibble: number,
  payloadBytes: Uint8Array,
): Promise<number> {
  const keyRaw = await meshCoreRegionKeyFromName(regionName);
  const keyBuf = new Uint8Array(16);
  keyBuf.set(keyRaw);
  const payloadTypeByte = (payloadTypeNibble << MESHCORE_TYPE_SHIFT) & MESHCORE_TYPE_MASK;
  const msgBuf = new Uint8Array(1 + payloadBytes.length);
  msgBuf[0] = payloadTypeByte;
  msgBuf.set(payloadBytes, 1);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuf,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, msgBuf);
  const sig = new Uint8Array(sigBuf);
  return sig[0] | (sig[1] << 8);
}

export async function meshCoreTransportCodeMatchesRegion(
  regionName: string,
  payloadTypeNibble: number,
  innerPayload: Uint8Array,
  transportCodeScope: number,
): Promise<boolean> {
  const code = await meshCoreTransportCodeForRegion(regionName, payloadTypeNibble, innerPayload);
  return code === transportCodeScope;
}

export function analyzeMeshCorePacketStructure(raw: Uint8Array): MeshCoreStructureAnalysis | null {
  const p = parseMeshCoreRfPacket(raw);
  if (!p.ok) return null;
  return p.structure;
}
