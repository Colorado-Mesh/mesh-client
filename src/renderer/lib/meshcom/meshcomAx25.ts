/**
 * AX.25 UI address + frame helpers for MeshCom KISS (no FCS on the wire).
 */

import { normalizeMeshcomCallsign } from './meshcomCallsign';

export const AX25_CONTROL_UI = 0x03;
export const AX25_PID_NO_LAYER3 = 0xf0;
export const AX25_ADDR_LEN = 7;

export interface Ax25Address {
  /** Callsign with optional SSID (`CALL` or `CALL-N`). */
  callsign: string;
  /** SSID 0–15 from the address field. */
  ssid: number;
  /** Ext bit set — last address in the field. */
  last: boolean;
  /** C/H bit (command/response or has-been-repeated). */
  commandOrRepeated: boolean;
}

export interface Ax25UiFrame {
  dest: Ax25Address;
  src: Ax25Address;
  digis: Ax25Address[];
  /** Info field bytes after control+PID. */
  info: Uint8Array;
}

function splitCallSsid(raw: string): { base: string; ssid: number } {
  const normalized = normalizeMeshcomCallsign(raw);
  const hyphen = normalized.lastIndexOf('-');
  if (hyphen < 0) {
    return { base: normalized, ssid: 0 };
  }
  const base = normalized.slice(0, hyphen);
  const ssid = Number.parseInt(normalized.slice(hyphen + 1), 10);
  return {
    base,
    ssid: Number.isFinite(ssid) ? Math.max(0, Math.min(99, ssid)) : 0,
  };
}

/** Encode one 7-byte AX.25 address field. SSID is clamped to 0–15 on the wire. */
export function encodeAx25Callsign(
  call: string,
  opts: { last: boolean; commandOrRepeated?: boolean },
): Uint8Array {
  const { base, ssid } = splitCallSsid(call);
  const padded = (base.toUpperCase() + '      ').slice(0, 6);
  const out = new Uint8Array(AX25_ADDR_LEN);
  for (let i = 0; i < 6; i++) {
    out[i] = (padded.charCodeAt(i) << 1) & 0xff;
  }
  // AX.25 only has 4 SSID bits — MeshCom clamps high SSIDs (16–99) to 15 on the wire.
  const wireSsid = Math.min(ssid, 15) & 0x0f;
  const ch = opts.commandOrRepeated ? 0x80 : 0x00;
  const ext = opts.last ? 0x01 : 0x00;
  out[6] = ch | 0x60 | ((wireSsid << 1) & 0x1e) | ext;
  return out;
}

/** Decode one 7-byte AX.25 address field. */
export function decodeAx25Callsign(field: Uint8Array | number[]): Ax25Address | null {
  if (field.length < AX25_ADDR_LEN) return null;
  let call = '';
  for (let i = 0; i < 6; i++) {
    const ch = (field[i] >> 1) & 0x7f;
    if (ch === 0x20) continue;
    if (ch < 0x20 || ch > 0x7e) continue;
    call += String.fromCharCode(ch);
  }
  call = call.trim().toUpperCase();
  const flag = field[6];
  const ssid = (flag >> 1) & 0x0f;
  const callsign = ssid > 0 ? `${call}-${ssid}` : call;
  return {
    callsign,
    ssid,
    last: (flag & 0x01) === 1,
    commandOrRepeated: (flag & 0x80) !== 0,
  };
}

/** Parse an AX.25 UI frame without FCS. */
export function parseAx25UiFrame(payload: Uint8Array | number[]): Ax25UiFrame | null {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  if (bytes.length < AX25_ADDR_LEN * 2 + 2) return null;

  const addrs: Ax25Address[] = [];
  let offset = 0;
  while (offset + AX25_ADDR_LEN <= bytes.length) {
    const decoded = decodeAx25Callsign(bytes.subarray(offset, offset + AX25_ADDR_LEN));
    if (!decoded) return null;
    addrs.push(decoded);
    offset += AX25_ADDR_LEN;
    if (decoded.last) break;
    if (addrs.length > 10) return null;
  }
  if (addrs.length < 2) return null;
  if (offset + 2 > bytes.length) return null;

  const control = bytes[offset];
  const pid = bytes[offset + 1];
  if (control !== AX25_CONTROL_UI || pid !== AX25_PID_NO_LAYER3) return null;

  // length >= 2 checked above — index 0/1 are present.
  return {
    dest: addrs[0],
    src: addrs[1],
    digis: addrs.slice(2),
    info: bytes.subarray(offset + 2),
  };
}

/** Build an AX.25 UI frame (no digipeaters, no FCS) for MeshCom KISS TX. */
export function buildAx25UiFrame(opts: {
  dest: string;
  src: string;
  info: Uint8Array | string;
}): Uint8Array {
  const infoBytes = typeof opts.info === 'string' ? new TextEncoder().encode(opts.info) : opts.info;
  const dest = encodeAx25Callsign(opts.dest, { last: false, commandOrRepeated: true });
  const src = encodeAx25Callsign(opts.src, { last: true, commandOrRepeated: false });
  const out = new Uint8Array(dest.length + src.length + 2 + infoBytes.length);
  out.set(dest, 0);
  out.set(src, dest.length);
  out[dest.length + src.length] = AX25_CONTROL_UI;
  out[dest.length + src.length + 1] = AX25_PID_NO_LAYER3;
  out.set(infoBytes, dest.length + src.length + 2);
  return out;
}

/** Format a 9-char space-padded APRS message addressee. */
export function formatAprsAddressee(dst: string): string {
  const trimmed = dst.trim().toUpperCase();
  if (trimmed === '*' || trimmed === '') return '*        ';
  return (trimmed + '         ').slice(0, 9);
}
