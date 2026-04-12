import { pubkeyToNodeId } from './meshcoreUtils';
import { MESHCORE_PAYLOAD_TYPE_ADVERT } from './rawPacketLogConstants';

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
  if (pkt.payload_type === MESHCORE_PAYLOAD_TYPE_ADVERT && pkt.payload.length >= 32) {
    const id = pubkeyToNodeId(pkt.payload.subarray(0, 32));
    if (id !== 0) return id;
  }
  if (pkt.payload.length >= 6) {
    const prefix = Array.from(pkt.payload.subarray(0, 6))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const id = pubKeyPrefixMap.get(prefix) ?? 0;
    if (id !== 0) return id;
  }
  return null;
}
