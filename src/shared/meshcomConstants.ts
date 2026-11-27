/** MeshCom EXTUDP JSON companion port (node ↔ client). */
export const MESHCOM_EXTUDP_PORT = 1799;

/** MeshCom KISS/TCP companion port (AX.25 UI over KISS). */
export const MESHCOM_KISS_TCP_PORT = 8001;

/** MeshCom NET Console TCP port (HMAC console / ExtUDP JSON over TCP). */
export const MESHCOM_NETCONSOLE_PORT = 2323;

/** USB serial console baud rate. */
export const MESHCOM_SERIAL_BAUD = 115200;

/**
 * Max chat text length (KISS info / EXTUDP / DB). Enforce before UI emit so a
 * 64 KiB KISS frame cannot land a huge string in the message store.
 */
export const MESHCOM_MAX_TEXT_LEN = 4096;

/**
 * Max UTF-8 bytes for serial/BLE chat address prefix + body (`{260}text` / `{CALL}text`).
 * Firmware `sendMessage()` rejects length > 160. EXTUDP JSON `msg` stays at 150 in
 * `MESHCOM_EXTUDP_MSG_MAX_LEN` (firmware `strlen(msg) > 150`).
 */
export const MESHCOM_WIRE_MAX_BYTES = 160;

/**
 * Max EXTUDP / DB `msg_id` length. Bound at parse time so a 64 KiB datagram cannot
 * use a huge string as the message-store key before DB validation.
 */
export const MESHCOM_MAX_MSG_ID_LEN = 128;

/** Soft cap for persisted contacts / in-memory callsign registry / node bucket. */
export const MESHCOM_CONTACT_CAP_DEFAULT = 10_000;

/**
 * Max MeshNeighbor rows retained per relay from MHEARD VIA links.
 * Matches Meshtastic's on-wire neighbor cap; contact-bucket trim alone does not bound this array.
 */
export const MESHCOM_RELAY_NEIGHBOR_CAP = 256;

/** Max MHEARD stations applied in one applyMeshcomMheardStations call. */
export const MESHCOM_MHEARD_APPLY_BURST_CAP = 512;

/**
 * Max MeshCom GRC group id (ICSSW). Chat `channel_idx` is -1 (DM), 0 (ALL), or 1..this.
 * Not a Meshtastic/MeshCore 0–255 PSK slot index.
 */
export const MESHCOM_GRC_ID_MAX = 99_999;

/** True when `channel_idx` is valid for MeshCom SQLite / IPC (-1 DM, 0 ALL, 1..GRC max). */
export function isValidMeshcomDbChannelIdx(channelIdx: number): boolean {
  return Number.isInteger(channelIdx) && channelIdx >= -1 && channelIdx <= MESHCOM_GRC_ID_MAX;
}

/** Reviewed firmware release pin mirrored in `scripts/update.sh`. */
/** Public MeshCom MeshMap (fed by gateways → MeshCom servers; not a companion API). */
export const MESHCOM_MESHMAP_URL = 'https://meshmap.oevsv.at/';
