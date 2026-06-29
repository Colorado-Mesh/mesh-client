import { type NodeHashCandidate, resolveNodeId } from '../../shared/meshcoreNodeHash';
import { meshcoreResolvePathSenderFromBytes } from '../../shared/meshcorePathHash';
import { type MeshCoreRfParseOk, parseMeshCoreRfPacket } from '../../shared/meshcoreRfPacketParse';
import {
  decodeMeshCorePathPrefix,
  MESHCORE_PAYLOAD_TYPE_ANON_REQ_NIBBLE,
  MESHCORE_PAYLOAD_TYPE_GRP_TXT_NIBBLE,
  meshCorePayloadTypeNibble,
  meshCorePayloadTypeStringFromByte0,
  meshCoreRouteTypeStringFromByte0,
} from '../../shared/meshcoreRfPath';
import { pubkeyToNodeId } from './meshcoreUtils';
import {
  MESHCORE_ADVERT_PUBKEY_BYTE_LEN,
  MESHCORE_PAYLOAD_TYPE_ADVERT,
} from './rawPacketLogConstants';
import type { MeshNode } from './types';

function pubkeyPrefixHex6(key: Uint8Array): string {
  return Array.from(key.subarray(0, 6), (b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * True when the RF frame originated from this device (own advert, loopback TX, etc.).
 * ADVERT payloads always carry a 32-byte pubkey; channel GRP_TXT/tapbacks may not.
 */
export function meshcoreRfIsSelfOriginated(
  raw: Uint8Array,
  selfPublicKey: Uint8Array | null | undefined,
  myNodeId: number,
): boolean {
  if (myNodeId === 0 || selfPublicKey?.length !== 32) return false;

  const parsed = parseMeshCoreRfPacket(raw);
  if (parsed.ok) {
    if (parsed.advert && bytesEqual(parsed.advert.publicKey, selfPublicKey)) return true;
    if (parsed.innerPayload.length >= 32) {
      const key = parsed.innerPayload.subarray(0, 32);
      if (bytesEqual(key, selfPublicKey)) return true;
      if (pubkeyToNodeId(key) === myNodeId) return true;
    }
    const resolved = meshcoreRawPacketResolveFromParsed(parsed, new Map());
    if (resolved === myNodeId) return true;
  }

  for (let i = 0; i <= raw.length - 32; i++) {
    if (bytesEqual(raw.subarray(i, i + 32), selfPublicKey)) return true;
  }
  return false;
}

/**
 * Resolve sender node id for Raw Packets (MeshCore `Packet` after `fromBytes`).
 * - ADVERT: canonical id from first 32 bytes (pubkey), matching contact `node_id` elsewhere.
 * - Other types: REQ/TXT_MSG ciphertext layouts need decryption for names — here we only try the
 *   6-byte pubkey prefix map when those bytes align (legacy / non-encrypted shapes).
 */
export function meshcoreRawPacketResolveFromNodeId(
  pkt: { payload: Uint8Array; payload_type: number },
  pubKeyPrefixMap: Map<string, number>,
): number | null {
  if (
    pkt.payload_type === MESHCORE_PAYLOAD_TYPE_ADVERT &&
    pkt.payload.length >= MESHCORE_ADVERT_PUBKEY_BYTE_LEN
  ) {
    const id = pubkeyToNodeId(pkt.payload.subarray(0, MESHCORE_ADVERT_PUBKEY_BYTE_LEN));
    if (id !== 0) return id;
  }
  if (pkt.payload.length >= 6) {
    const id = pubKeyPrefixMap.get(pubkeyPrefixHex6(pkt.payload)) ?? 0;
    if (id !== 0) return id;
  }
  return null;
}

/** Build routing-hash candidates from a node map (prefers recently heard nodes for strong RSSI). */
export function meshcoreRfNodeHashCandidates(
  nodes: Map<number, MeshNode>,
  excludeNodeId: number,
  options?: { rssi?: number; recentWindowSec?: number },
): NodeHashCandidate[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const recentWindowSec = options?.recentWindowSec ?? 600;
  const preferRecent = options?.rssi !== undefined && options.rssi > -80 && recentWindowSec > 0;
  const recentCutoff = preferRecent ? nowSec - recentWindowSec : 0;
  const all = [...nodes.values()].filter((n) => n.node_id !== excludeNodeId);
  const filtered = recentCutoff > 0 ? all.filter((n) => (n.last_heard ?? 0) >= recentCutoff) : all;
  const pool = filtered.length > 0 ? filtered : all;
  return pool.map((n) => ({ node_id: n.node_id, last_heard: n.last_heard ?? 0 }));
}

/**
 * Resolve flood-path originator from routing hashes (tries every hop segment; prefers freshest contact).
 */
export function meshcoreRfResolvePathSender(
  pathBytes: number[],
  candidates: NodeHashCandidate[],
  options?: {
    hashSizeBytes?: 1 | 2 | 3;
    pubKeyByNodeId?: ReadonlyMap<number, Uint8Array>;
  },
): number | null {
  if (pathBytes.length === 0 || candidates.length === 0) return null;
  const hashSizeBytes = options?.hashSizeBytes ?? 1;
  if (hashSizeBytes === 1 && !options?.pubKeyByNodeId) {
    const byId = new Map(candidates.map((c) => [c.node_id, c]));
    let bestId: number | null = null;
    let bestHeard = 0;
    for (const byte of pathBytes) {
      const id = resolveNodeId(byte, candidates);
      if (id == null) continue;
      const heard = byId.get(id)?.last_heard ?? 0;
      if (bestId == null || heard >= bestHeard) {
        bestId = id;
        bestHeard = heard;
      }
    }
    return bestId;
  }
  return meshcoreResolvePathSenderFromBytes(
    pathBytes,
    hashSizeBytes,
    candidates,
    options?.pubKeyByNodeId,
  );
}

/** Resolve sender node id from a full in-house RF parse (preferred for raw log). */
export function meshcoreRawPacketResolveFromParsed(
  parsed: MeshCoreRfParseOk,
  pubKeyPrefixMap: Map<string, number>,
): number | null {
  const inner = parsed.innerPayload;
  if (
    parsed.payloadTypeNibble === MESHCORE_PAYLOAD_TYPE_ADVERT &&
    inner.length >= MESHCORE_ADVERT_PUBKEY_BYTE_LEN
  ) {
    if (parsed.advert) {
      const id = pubkeyToNodeId(parsed.advert.publicKey);
      if (id !== 0) return id;
    }
    const key = inner.subarray(0, MESHCORE_ADVERT_PUBKEY_BYTE_LEN);
    const id = pubkeyToNodeId(key);
    if (id !== 0) return id;
    const mapped = pubKeyPrefixMap.get(pubkeyPrefixHex6(key)) ?? 0;
    if (mapped !== 0) return mapped;
  } else if (parsed.payloadTypeNibble === MESHCORE_PAYLOAD_TYPE_ANON_REQ_NIBBLE) {
    // ANON_REQ inner: dest_hash(1) | sender_pubkey(32) | mac(2) | ciphertext
    if (inner.length >= 33) {
      const key = inner.subarray(1, 33);
      const id = pubkeyToNodeId(key);
      if (id !== 0) return id;
      const mapped = pubKeyPrefixMap.get(pubkeyPrefixHex6(key)) ?? 0;
      if (mapped !== 0) return mapped;
    }
  } else if (
    parsed.payloadTypeNibble !== MESHCORE_PAYLOAD_TYPE_GRP_TXT_NIBBLE &&
    inner.length >= 6
  ) {
    // GRP_TXT inner starts with channel_hash, not a pubkey prefix — skip prefix lookup
    const mapped = pubKeyPrefixMap.get(pubkeyPrefixHex6(inner)) ?? 0;
    if (mapped !== 0) return mapped;
  }
  return null;
}

/**
 * When `Packet.fromBytes` throws, recover route/payload labels, hop count, and (for ADVERT) sender
 * from the raw RF buffer using the same path-prefix layout as main `meshcore-path-decoder`.
 */
export function meshcoreRawPacketLogFromBytesFallback(
  raw: Uint8Array,
  pubKeyPrefixMap: Map<string, number>,
): {
  routeTypeString: string;
  payloadTypeString: string;
  hopCount: number;
  fromNodeId: number | null;
} | null {
  try {
    const { hops, pathEndOffset } = decodeMeshCorePathPrefix(raw);
    const byte0 = raw[0];
    const routeTypeString = meshCoreRouteTypeStringFromByte0(byte0);
    const payloadTypeString = meshCorePayloadTypeStringFromByte0(byte0);
    const payloadNibble = meshCorePayloadTypeNibble(byte0);
    let fromNodeId: number | null = null;
    if (payloadNibble === MESHCORE_PAYLOAD_TYPE_ADVERT) {
      if (raw.length >= pathEndOffset + MESHCORE_ADVERT_PUBKEY_BYTE_LEN) {
        const key = raw.subarray(pathEndOffset, pathEndOffset + MESHCORE_ADVERT_PUBKEY_BYTE_LEN);
        const id = pubkeyToNodeId(key);
        if (id !== 0) {
          fromNodeId = id;
        } else if (raw.length >= pathEndOffset + 6) {
          const prefix = pubkeyPrefixHex6(key);
          const mapped = pubKeyPrefixMap.get(prefix) ?? 0;
          if (mapped !== 0) fromNodeId = mapped;
        }
      }
    } else if (payloadNibble === MESHCORE_PAYLOAD_TYPE_ANON_REQ_NIBBLE) {
      // ANON_REQ inner: dest_hash(1) | sender_pubkey(32) | mac(2) | ciphertext
      if (raw.length >= pathEndOffset + 33) {
        const key = raw.subarray(pathEndOffset + 1, pathEndOffset + 33);
        const id = pubkeyToNodeId(key);
        if (id !== 0) {
          fromNodeId = id;
        } else {
          const prefix = pubkeyPrefixHex6(key);
          const mapped = pubKeyPrefixMap.get(prefix) ?? 0;
          if (mapped !== 0) fromNodeId = mapped;
        }
      }
    } else if (
      payloadNibble !== MESHCORE_PAYLOAD_TYPE_GRP_TXT_NIBBLE &&
      raw.length >= pathEndOffset + 6
    ) {
      // GRP_TXT inner starts with channel_hash, not a pubkey prefix — skip prefix lookup
      const inner = raw.subarray(pathEndOffset);
      const mapped = pubKeyPrefixMap.get(pubkeyPrefixHex6(inner)) ?? 0;
      if (mapped !== 0) fromNodeId = mapped;
    }
    return {
      routeTypeString,
      payloadTypeString,
      hopCount: hops,
      fromNodeId,
    };
  } catch {
    // catch-no-log-ok buffer is not a MeshCore path-prefix frame — fallback unavailable
    return null;
  }
}
