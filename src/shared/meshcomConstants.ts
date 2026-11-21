/** MeshCom EXTUDP JSON companion port (node ↔ client). */
export const MESHCOM_EXTUDP_PORT = 1799;

/** MeshCom KISS/TCP companion port (AX.25 UI over KISS). */
export const MESHCOM_KISS_TCP_PORT = 8001;

/** USB serial console baud rate. */
export const MESHCOM_SERIAL_BAUD = 115200;

/**
 * Max chat text length (KISS info / EXTUDP / DB). Enforce before UI emit so a
 * 64 KiB KISS frame cannot land a huge string in the message store.
 */
export const MESHCOM_MAX_TEXT_LEN = 4096;

/**
 * Max EXTUDP / DB `msg_id` length. Bound at parse time so a 64 KiB datagram cannot
 * use a huge string as the message-store key before DB validation.
 */
export const MESHCOM_MAX_MSG_ID_LEN = 128;

/** Soft cap for persisted contacts / in-memory callsign registry / node bucket. */
export const MESHCOM_CONTACT_CAP_DEFAULT = 10_000;

/** Reviewed firmware release pin mirrored in `scripts/update.sh`. */
export const MESHCOM_FIRMWARE_REVIEWED_REF = 'v4.40a.11.14';
