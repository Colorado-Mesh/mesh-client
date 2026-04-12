/** Ring-buffer size for Raw Packets tab (MeshCore LOG_RX_DATA and Meshtastic onMeshPacket). */
export const MAX_RAW_PACKET_LOG_ENTRIES = 2500;

/** Meshtastic row for the raw packet log (protobuf-serialized mesh packet). */
export interface MeshtasticRawPacketEntry {
  ts: number;
  snr: number;
  rssi: number;
  raw: Uint8Array;
  fromNodeId: number | null;
  portLabel: string;
  viaMqtt: boolean;
}
