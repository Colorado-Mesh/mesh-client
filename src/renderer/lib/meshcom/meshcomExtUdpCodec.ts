/**
 * MeshCom EXTUDP JSON (UDP :1799) parse/serialize.
 * Spec: firmware `extudp_functions.cpp`, `extern_msg_json.h`, `docs/ext_udp_telemetry.md`.
 */

import {
  MESHCOM_EXTUDP_PORT,
  MESHCOM_MAX_MSG_ID_LEN,
  MESHCOM_MAX_TEXT_LEN,
} from '@/shared/meshcomConstants';

import {
  MESHCOM_CALLSIGN_MAX_LEN,
  MESHCOM_EXTUDP_DST_MAX_LEN,
  normalizeMeshcomCallsign,
} from './meshcomCallsign';
import { truncateToWireBytes } from './meshcomWireLimits';

export { MESHCOM_EXTUDP_PORT, MESHCOM_MAX_MSG_ID_LEN };
/** Firmware EXTUDP `msg` gate: reject when `strlen(msg) > 150` (UTF-8 bytes). */
export const MESHCOM_EXTUDP_MSG_MAX_LEN = 150;
/** Bound firmware / src_type / aprs metadata strings retained from EXTUDP peers. */
const MESHCOM_EXTUDP_META_MAX_LEN = 64;

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

function asOptionalBoundedString(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asOptionalFirmware(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return asOptionalBoundedString(value, MESHCOM_EXTUDP_META_MAX_LEN);
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
    const msg = truncateToWireBytes(outbound.msg, MESHCOM_EXTUDP_MSG_MAX_LEN);
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
  } catch (e: unknown) {
    console.debug('[renderer/lib/meshcom/meshcomExtUdpCodec] catch:', e);

    return null;
  }
  if (!isRecord(parsed)) return null;
  const type = parsed.type;
  if (type === 'msg') {
    const srcRaw = asOptionalString(parsed.src);
    const dstRaw = asOptionalString(parsed.dst);
    const msgRaw = asOptionalString(parsed.msg);
    if (srcRaw == null || dstRaw == null || msgRaw == null) return null;
    const src = normalizeMeshcomCallsign(srcRaw).slice(0, MESHCOM_CALLSIGN_MAX_LEN);
    const dst =
      dstRaw === '*'
        ? '*'
        : /^\d+$/.test(dstRaw.trim())
          ? dstRaw.trim().slice(0, MESHCOM_EXTUDP_DST_MAX_LEN)
          : normalizeMeshcomCallsign(dstRaw).slice(0, MESHCOM_EXTUDP_DST_MAX_LEN);
    const msg = msgRaw.slice(0, MESHCOM_EXTUDP_MSG_MAX_LEN);
    if (!src || !dst || !msg) return null;
    return {
      type: 'msg',
      src,
      dst,
      msg,
      msg_id: asOptionalBoundedString(parsed.msg_id, MESHCOM_MAX_MSG_ID_LEN),
      src_type: asOptionalBoundedString(parsed.src_type, MESHCOM_EXTUDP_META_MAX_LEN),
      firmware: asOptionalFirmware(parsed.firmware),
      fw_sub: asOptionalBoundedString(parsed.fw_sub, MESHCOM_EXTUDP_META_MAX_LEN),
      rssi: asOptionalNumber(parsed.rssi),
      snr: asOptionalNumber(parsed.snr),
      hw_id: asOptionalNumber(parsed.hw_id),
      lora_mod: asOptionalNumber(parsed.lora_mod),
      max_hop: asOptionalNumber(parsed.max_hop),
    };
  }
  if (type === 'pos') {
    const srcRaw = asOptionalString(parsed.src);
    if (srcRaw == null) return null;
    const src = normalizeMeshcomCallsign(srcRaw).slice(0, MESHCOM_CALLSIGN_MAX_LEN);
    if (!src) return null;
    const posMsg = asOptionalBoundedString(parsed.msg, MESHCOM_MAX_TEXT_LEN);
    return {
      type: 'pos',
      src,
      msg: posMsg,
      lat: asOptionalNumber(parsed.lat),
      lat_dir: asOptionalBoundedString(parsed.lat_dir, MESHCOM_EXTUDP_META_MAX_LEN),
      long: asOptionalNumber(parsed.long),
      long_dir: asOptionalBoundedString(parsed.long_dir, MESHCOM_EXTUDP_META_MAX_LEN),
      aprs_symbol: asOptionalBoundedString(parsed.aprs_symbol, MESHCOM_EXTUDP_META_MAX_LEN),
      aprs_symbol_group: asOptionalBoundedString(
        parsed.aprs_symbol_group,
        MESHCOM_EXTUDP_META_MAX_LEN,
      ),
      hw_id: asOptionalNumber(parsed.hw_id),
      msg_id: asOptionalBoundedString(parsed.msg_id, MESHCOM_MAX_MSG_ID_LEN),
      alt: asOptionalNumber(parsed.alt),
      lora_mod: asOptionalNumber(parsed.lora_mod),
      max_hop: asOptionalNumber(parsed.max_hop),
      batt: asOptionalNumber(parsed.batt),
      firmware: asOptionalFirmware(parsed.firmware),
      fw_sub: asOptionalBoundedString(parsed.fw_sub, MESHCOM_EXTUDP_META_MAX_LEN),
      rssi: asOptionalNumber(parsed.rssi),
      snr: asOptionalNumber(parsed.snr),
      src_type: asOptionalBoundedString(parsed.src_type, MESHCOM_EXTUDP_META_MAX_LEN),
    };
  }
  if (type === 'tele') {
    const teleSrc = asOptionalString(parsed.src);
    // Firmware outbound (extern_tele_json.h TLM-04) uses temp1/qfe/gas; client→node
    // injection (ext_udp_telemetry.md) still uses temp/press/gasres — accept both.
    return {
      type: 'tele',
      src: teleSrc
        ? normalizeMeshcomCallsign(teleSrc).slice(0, MESHCOM_CALLSIGN_MAX_LEN) || undefined
        : undefined,
      temp: asOptionalNumber(parsed.temp) ?? asOptionalNumber(parsed.temp1),
      hum: asOptionalNumber(parsed.hum),
      press: asOptionalNumber(parsed.press) ?? asOptionalNumber(parsed.qfe),
      temp2: asOptionalNumber(parsed.temp2),
      qnh: asOptionalNumber(parsed.qnh),
      gasres: asOptionalNumber(parsed.gasres) ?? asOptionalNumber(parsed.gas),
      co2: asOptionalNumber(parsed.co2),
      batt: asOptionalNumber(parsed.batt),
    };
  }
  return null;
}
