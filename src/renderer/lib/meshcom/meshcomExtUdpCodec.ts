/**
 * MeshCom EXTUDP JSON (UDP :1799) parse/serialize.
 * Spec: firmware `extudp_functions.cpp`, `extern_msg_json.h`, `docs/ext_udp_telemetry.md`.
 */

import { MESHCOM_EXTUDP_PORT } from '@/shared/meshcomConstants';

import { MESHCOM_EXTUDP_DST_MAX_LEN, normalizeMeshcomCallsign } from './meshcomCallsign';

export { MESHCOM_EXTUDP_PORT };
export const MESHCOM_EXTUDP_MSG_MAX_LEN = 150;

export type MeshcomExtUdpOutbound =
  | { type: 'msg'; dst: string; msg: string }
  | {
      type: 'tele';
      temp?: number;
      hum?: number;
      press?: number;
      temp2?: number;
      qnh?: number;
      gasres?: number;
      co2?: number;
    };

export interface MeshcomExtUdpMsgInbound {
  type: 'msg';
  src: string;
  dst: string;
  msg: string;
  msg_id?: string;
  src_type?: string;
  firmware?: string | number;
  fw_sub?: string;
  rssi?: number;
  snr?: number;
  hw_id?: number;
  lora_mod?: number;
  max_hop?: number;
}

export interface MeshcomExtUdpPosInbound {
  type: 'pos';
  src: string;
  msg?: string;
  lat?: number;
  lat_dir?: string;
  long?: number;
  long_dir?: string;
  aprs_symbol?: string;
  aprs_symbol_group?: string;
  hw_id?: number;
  msg_id?: string;
  alt?: number;
  lora_mod?: number;
  max_hop?: number;
  batt?: number;
  firmware?: string | number;
  fw_sub?: string;
  rssi?: number;
  snr?: number;
  src_type?: string;
}

export interface MeshcomExtUdpTeleInbound {
  type: 'tele';
  src?: string;
  temp?: number;
  hum?: number;
  press?: number;
  temp2?: number;
  qnh?: number;
  gasres?: number;
  co2?: number;
  batt?: number;
  [key: string]: unknown;
}

export type MeshcomExtUdpInbound =
  MeshcomExtUdpMsgInbound | MeshcomExtUdpPosInbound | MeshcomExtUdpTeleInbound;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asOptionalFirmware(value: unknown): string | number | undefined {
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
    return value;
  }
  return undefined;
}

/** Validate and clamp client→node outbound payloads. */
export function serializeMeshcomExtUdp(outbound: MeshcomExtUdpOutbound): string {
  if (outbound.type === 'msg') {
    const dstRaw = outbound.dst.trim();
    if (!dstRaw) {
      throw new Error('meshcom EXTUDP msg: dst required');
    }
    const dst =
      dstRaw === '*'
        ? '*'
        : /^\d+$/.test(dstRaw)
          ? dstRaw.slice(0, MESHCOM_EXTUDP_DST_MAX_LEN)
          : normalizeMeshcomCallsign(dstRaw).slice(0, MESHCOM_EXTUDP_DST_MAX_LEN);
    if (!dst || dst.length < 1) {
      throw new Error('meshcom EXTUDP msg: dst must be 1–9 characters');
    }
    const msg = outbound.msg.slice(0, MESHCOM_EXTUDP_MSG_MAX_LEN);
    return JSON.stringify({ type: 'msg', dst, msg });
  }

  const tele: Record<string, number | string> = { type: 'tele' };
  const keys = ['temp', 'hum', 'press', 'temp2', 'qnh', 'gasres', 'co2'] as const;
  let any = false;
  for (const key of keys) {
    const v = outbound[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      tele[key] = v;
      any = true;
    }
  }
  if (!any) {
    throw new Error('meshcom EXTUDP tele: at least one sensor field required');
  }
  return JSON.stringify(tele);
}

/** Parse node→client EXTUDP JSON; returns null when invalid / unknown type. */
export function parseMeshcomExtUdp(raw: string | Uint8Array): MeshcomExtUdpInbound | null {
  const text =
    typeof raw === 'string' ? raw : new TextDecoder('utf-8', { fatal: false }).decode(raw);
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    // catch-no-log-ok invalid EXTUDP datagram
    return null;
  }
  if (!isRecord(parsed)) return null;
  const type = parsed.type;
  if (type === 'msg') {
    const src = asOptionalString(parsed.src);
    const dst = asOptionalString(parsed.dst);
    const msg = asOptionalString(parsed.msg);
    if (src == null || dst == null || msg == null) return null;
    return {
      type: 'msg',
      src,
      dst,
      msg,
      msg_id: asOptionalString(parsed.msg_id),
      src_type: asOptionalString(parsed.src_type),
      firmware: asOptionalFirmware(parsed.firmware),
      fw_sub: asOptionalString(parsed.fw_sub),
      rssi: asOptionalNumber(parsed.rssi),
      snr: asOptionalNumber(parsed.snr),
      hw_id: asOptionalNumber(parsed.hw_id),
      lora_mod: asOptionalNumber(parsed.lora_mod),
      max_hop: asOptionalNumber(parsed.max_hop),
    };
  }
  if (type === 'pos') {
    const src = asOptionalString(parsed.src);
    if (src == null) return null;
    return {
      type: 'pos',
      src,
      msg: asOptionalString(parsed.msg),
      lat: asOptionalNumber(parsed.lat),
      lat_dir: asOptionalString(parsed.lat_dir),
      long: asOptionalNumber(parsed.long),
      long_dir: asOptionalString(parsed.long_dir),
      aprs_symbol: asOptionalString(parsed.aprs_symbol),
      aprs_symbol_group: asOptionalString(parsed.aprs_symbol_group),
      hw_id: asOptionalNumber(parsed.hw_id),
      msg_id: asOptionalString(parsed.msg_id),
      alt: asOptionalNumber(parsed.alt),
      lora_mod: asOptionalNumber(parsed.lora_mod),
      max_hop: asOptionalNumber(parsed.max_hop),
      batt: asOptionalNumber(parsed.batt),
      firmware: asOptionalFirmware(parsed.firmware),
      fw_sub: asOptionalString(parsed.fw_sub),
      rssi: asOptionalNumber(parsed.rssi),
      snr: asOptionalNumber(parsed.snr),
      src_type: asOptionalString(parsed.src_type),
    };
  }
  if (type === 'tele') {
    return {
      type: 'tele',
      src: asOptionalString(parsed.src),
      temp: asOptionalNumber(parsed.temp),
      hum: asOptionalNumber(parsed.hum),
      press: asOptionalNumber(parsed.press),
      temp2: asOptionalNumber(parsed.temp2),
      qnh: asOptionalNumber(parsed.qnh),
      gasres: asOptionalNumber(parsed.gasres),
      co2: asOptionalNumber(parsed.co2),
      batt: asOptionalNumber(parsed.batt),
    };
  }
  return null;
}
