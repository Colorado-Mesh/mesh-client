/**
 * MeshCom BLE phone framing (Nordic UART).
 * Spec: firmware `ble_phone_frame.h` / phone_commands.cpp.
 */

/** `{HELLO}` = `04 10 20 30` — optional PIN SHA-256 follows in some firmwares. */
export const MESHCOM_BLE_HELLO = new Uint8Array([0x04, 0x10, 0x20, 0x30]);

export const MESHCOM_BLE_CMD_TEXT = 0xa0;
export const MESHCOM_BLE_MH_TYPE = 0x91;
export const MESHCOM_BLE_SAVE_REBOOT = 0xf0;

/** Encode a UTF-8 companion command (`len+2 | 0xA0 | utf8`). */
export function encodeMeshcomBleCommand(utf8: string): Uint8Array {
  const body = new TextEncoder().encode(utf8);
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

export type MeshcomBleInbound =
  | { kind: 'text'; text: string }
  | { kind: 'json'; json: string }
  | { kind: 'binary'; type: number; payload: Uint8Array }
  | { kind: 'hello_ack' };

/**
 * Parse one or more concatenated BLE phone frames from a NUS notification chunk.
 * Frames start with length byte (total frame length including length byte).
 */
export function parseMeshcomBleFrames(chunk: Uint8Array): MeshcomBleInbound[] {
  const out: MeshcomBleInbound[] = [];
  let offset = 0;
  while (offset < chunk.length) {
    // ASCII `@` text / `D{` JSON shortcuts used by some firmwares
    if (chunk[offset] === 0x40 /* @ */) {
      const rest = chunk.subarray(offset + 1);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(rest);
      out.push({ kind: 'text', text });
      break;
    }
    if (chunk[offset] === 0x44 /* D */ && chunk[offset + 1] === 0x7b /* { */) {
      const json = new TextDecoder('utf-8', { fatal: false }).decode(chunk.subarray(offset + 1));
      out.push({ kind: 'json', json });
      break;
    }

    const len = chunk[offset];
    if (len < 2 || offset + len > chunk.length) {
      // Incomplete or raw — treat remainder as text
      const text = new TextDecoder('utf-8', { fatal: false }).decode(chunk.subarray(offset));
      if (text.trim()) out.push({ kind: 'text', text });
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
        text: new TextDecoder('utf-8', { fatal: false }).decode(payload),
      });
    } else {
      out.push({ kind: 'binary', type, payload: payload.slice() });
    }
    offset += len;
  }
  return out;
}
