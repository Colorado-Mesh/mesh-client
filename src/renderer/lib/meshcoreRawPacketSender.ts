import type { MeshCoreRfParseOk } from '../../shared/meshcoreRfPacketParse';
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

function pubkeyPrefixHex6(key: Uint8Array): string {
  return Array.from(key.subarray(0, 6), (b) => b.toString(16).padStart(2, '0')).join('');
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
