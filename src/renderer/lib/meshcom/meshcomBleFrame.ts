/**
 * MeshCom BLE phone framing (Nordic UART).
 * Spec: firmware `ble_phone_frame.h` / phone_commands.cpp.
 */

import { sanitizeMeshcomWireLine } from './meshcomWireSanitize';

/** `{HELLO}` = `04 10 20 30` — optional PIN SHA-256 follows in some firmwares. */
export const MESHCOM_BLE_HELLO = new Uint8Array([0x04, 0x10, 0x20, 0x30]);

export const MESHCOM_BLE_CMD_TEXT = 0xa0;
export const MESHCOM_BLE_MH_TYPE = 0x91;
export const MESHCOM_BLE_TIMESTAMP = 0x20;
export const MESHCOM_BLE_SAVE_REBOOT = 0xf0;

/** Encode a UTF-8 companion command (`len+2 | 0xA0 | utf8`). */
export function encodeMeshcomBleCommand(utf8: string): Uint8Array {
  const body = new TextEncoder().encode(sanitizeMeshcomWireLine(utf8));
  const len = body.length + 2;
  if (len > 255) {
    throw new Error('meshcom BLE command too long');
  }
  const out = new Uint8Array(len);
  out[0] = len;
  out[1] = MESHCOM_BLE_CMD_TEXT;
  out.set(body, 2);
  return out;
}

/**
 * Encode BLE timestamp config (`len | 0x20 | unix_secs LE`) after CONFFIN.
 * Firmware `readPhoneCommand` case 0x20.
 */
export function encodeMeshcomBleTimestamp(unixSecs: number): Uint8Array {
  const secs = Math.floor(unixSecs) >>> 0;
  const out = new Uint8Array(6);
  out[0] = 6;
  out[1] = MESHCOM_BLE_TIMESTAMP;
  out[2] = secs & 0xff;
  out[3] = (secs >>> 8) & 0xff;
  out[4] = (secs >>> 16) & 0xff;
  out[5] = (secs >>> 24) & 0xff;
  return out;
}

/** Encode BLE save-to-flash + reboot (`len | 0xF0`). */
export function encodeMeshcomBleSaveReboot(): Uint8Array {
  return new Uint8Array([2, MESHCOM_BLE_SAVE_REBOOT]);
}

export type MeshcomBleInbound =
  | { kind: 'text'; text: string }
  | { kind: 'json'; json: string }
  /** APRS phone frame after BLE `@` tag (binary — do not UTF-8-decode). */
  | { kind: 'phone_aprs'; bytes: Uint8Array }
  | { kind: 'binary'; type: number; payload: Uint8Array }
  | { kind: 'hello_ack' };

/**
 * Firmware `blePhonePush` sends `blelen + 2` bytes from a zero-filled buffer, so
 * JSON/`D{…}` notifies often end with trailing NUL padding. Strip that before
 * `JSON.parse` (a single `\0` makes parse fail).
 */
export function sanitizeMeshcomBleJsonText(raw: string): string {
  const nul = raw.indexOf('\0');
  const cut = nul >= 0 ? raw.slice(0, nul) : raw;
  return cut.trim();
}

/**
 * Parse one or more concatenated BLE phone frames from a NUS notification chunk.
 * Frames start with length byte (total frame length including length byte),
 * or unframed `@` / `D{` shortcuts from some firmwares.
 */
export function parseMeshcomBleFrames(chunk: Uint8Array): MeshcomBleInbound[] {
  const out: MeshcomBleInbound[] = [];
  let offset = 0;
  while (offset < chunk.length) {
    // ASCII `@` + APRS phone frame (text/POS/ACK) — keep binary intact.
    if (chunk[offset] === 0x40 /* @ */) {
      // Firmware BLE phone drain sends one notify = one frame (see ble_phone_drain.h).
      out.push({ kind: 'phone_aprs', bytes: chunk.subarray(offset + 1) });
      break;
    }
    if (chunk[offset] === 0x44 /* D */ && chunk[offset + 1] === 0x7b /* { */) {
      const json = sanitizeMeshcomBleJsonText(
        new TextDecoder('utf-8', { fatal: false }).decode(chunk.subarray(offset + 1)),
      );
      if (json) out.push({ kind: 'json', json });
      break;
    }

    const len = chunk[offset];
    if (len < 2 || offset + len > chunk.length) {
      // Incomplete or raw — treat remainder as text
      const text = sanitizeMeshcomBleJsonText(
        new TextDecoder('utf-8', { fatal: false }).decode(chunk.subarray(offset)),
      );
      if (text) out.push({ kind: 'text', text });
      break;
    }
    const type = chunk[offset + 1];
    const payload = chunk.subarray(offset + 2, offset + len);
    if (
      type === MESHCOM_BLE_HELLO[1] &&
      payload.length >= 2 &&
      payload[0] === MESHCOM_BLE_HELLO[2] &&
      payload[1] === MESHCOM_BLE_HELLO[3]
    ) {
      out.push({ kind: 'hello_ack' });
    } else if (type === MESHCOM_BLE_CMD_TEXT || type === 0x00) {
      out.push({
        kind: 'text',
        text: sanitizeMeshcomBleJsonText(
          new TextDecoder('utf-8', { fatal: false }).decode(payload),
        ),
      });
    } else if (type === 0x40 /* @ */ && payload.length > 0) {
      // Length-prefixed phone APRS (tag in type byte, body in payload).
      out.push({ kind: 'phone_aprs', bytes: payload.slice() });
    } else {
      out.push({ kind: 'binary', type, payload: payload.slice() });
    }
    offset += len;
  }
  return out;
}
