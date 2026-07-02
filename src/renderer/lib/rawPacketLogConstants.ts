/** Ring-buffer size for the Sniffer tab (MeshCore LOG_RX_DATA and Meshtastic onMeshPacket). */
export const MAX_RAW_PACKET_LOG_ENTRIES = 2500;

function rawPacketPrefixHex(raw: Uint8Array): string {
  return raw.length > 0
    ? Array.from(raw.subarray(0, Math.min(4, raw.length)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    : 'empty';
}

/** Content identity for a sniffer row (ts + length + first 4 bytes). Can collide for duplicate captures. */
export function rawPacketContentKey(ts: number, raw: Uint8Array): string {
  return `${ts}-${raw.length}-${rawPacketPrefixHex(raw)}`;
}

/** Unique virtualizer/React key per list index even when content is identical. */
export function rawPacketVirtualizerKey(ts: number, raw: Uint8Array, index: number): string {
  return `${rawPacketContentKey(ts, raw)}-${index}`;
}

/** Returns keys that appear more than once when mapped with index. */
export function findDuplicateVirtualizerKeys<T>(
  entries: readonly T[],
  getKey: (entry: T, index: number) => string,
): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const key = getKey(entries[i], i);
    if (seen.has(key)) {
      if (!dupes.includes(key)) dupes.push(key);
    } else {
      seen.add(key);
    }
  }
  return dupes;
}

/**
 * MeshCore header payload type bits 2–5 (`PAYLOAD_TYPE_ADVERT`). Inner payload begins with a
 * 32-byte Ed25519 public key per MeshCore `docs/payloads.md`.
 */
export const MESHCORE_PAYLOAD_TYPE_ADVERT = 4;

/** Ed25519 public key length in ADVERT inner payload (same as contact / `pubkeyToNodeId`). */
export const MESHCORE_ADVERT_PUBKEY_BYTE_LEN = 32;

/** Meshtastic row for the raw packet log (protobuf-serialized mesh packet). */
export interface MeshtasticRawPacketEntry {
  ts: number;
  snr: number;
  rssi: number;
  raw: Uint8Array;
  fromNodeId: number | null;
  portLabel: string;
  viaMqtt: boolean;
  isLocal?: boolean;
}

/** Reticulum RNS wire frame from sidecar packet tap. */
export interface ReticulumRawPacketEntry {
  ts: number;
  direction: 'rx' | 'tx';
  interfaceId: number;
  interfaceName: string;
  raw: Uint8Array;
  rssi?: number | null;
  snr?: number | null;
  q?: number | null;
  packetType?: string | null;
  headerType?: string | null;
  destinationHash?: string | null;
  transportType?: string | null;
  context?: string | null;
}
