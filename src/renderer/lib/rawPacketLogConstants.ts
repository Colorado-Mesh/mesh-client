/** Ring-buffer size for the Sniffer tab (MeshCore LOG_RX_DATA and Meshtastic onMeshPacket). */
export const MAX_RAW_PACKET_LOG_ENTRIES = 2500;

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
