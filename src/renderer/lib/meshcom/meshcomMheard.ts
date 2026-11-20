/**
 * MeshCom MHEARD / neighbor heard-list parsers (BLE TYP MH JSON + serial `--mheard` rows).
 * Firmware: `mh_phone.cpp` / `--mheard` (v4.40+ row format).
 */

import { normalizeMeshcomCallsign } from './meshcomCallsign';

export interface MeshcomMheardStation {
  callsign: string;
  rssi?: number;
  snr?: number;
  hwId?: number;
  distanceKm?: number;
  /** Age in minutes when reported. */
  ageMin?: number;
  mesh?: boolean;
  via?: string;
}

function asFiniteNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  }
  return undefined;
}

/** Parse one BLE companion `{"TYP":"MH",...}` object into a station row. */
export function parseMeshcomMhJson(doc: unknown): MeshcomMheardStation | null {
  if (typeof doc !== 'object' || doc === null) return null;
  const o = doc as Record<string, unknown>;
  const typ = asString(o.TYP);
  if (typ != null && typ !== 'MH') return null;
  const call = normalizeMeshcomCallsign(asString(o.CALL) ?? '');
  if (!call) return null;
  const dist = asFiniteNumber(o.DIST);
  const meshRaw = o.MESH;
  const mesh =
    meshRaw === true || meshRaw === 1 || meshRaw === '1' || meshRaw === 'on'
      ? true
      : meshRaw === false || meshRaw === 0 || meshRaw === '0' || meshRaw === 'off'
        ? false
        : undefined;
  return {
    callsign: call,
    rssi: asFiniteNumber(o.RSSI),
    snr: asFiniteNumber(o.SNR),
    hwId: asFiniteNumber(o.HW),
    distanceKm: dist != null && dist >= 0 ? dist : undefined,
    ageMin: asFiniteNumber(o.AGE),
    mesh,
    via: asString(o.VIA),
  };
}

/**
 * Parse serial `--mheard` console text into stations.
 * Accepts v4.40 row lines that start with a callsign; ignores headers/blank lines.
 */
export function parseMeshcomMheardText(text: string): MeshcomMheardStation[] {
  const out: MeshcomMheardStation[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--') || trimmed.startsWith('[')) continue;
    // Row: CALL … optional RSSI/SNR tokens
    const callMatch = /^([A-Za-z0-9]{3,7}-?\d{0,2})\b/.exec(trimmed);
    if (!callMatch?.[1]) continue;
    const call = normalizeMeshcomCallsign(callMatch[1]);
    if (!call || seen.has(call)) continue;
    seen.add(call);
    const rssi = /(?:^|\s)(-?\d{1,3})\s*(?:dBm|RSSI)/i.exec(trimmed);
    const snr = /(?:SNR|snr)\s*[:=]?\s*(-?\d+\.?\d*)/i.exec(trimmed);
    const dist = /(?:DIST|dist)\s*[:=]?\s*(-?\d+\.?\d*)/i.exec(trimmed);
    out.push({
      callsign: call,
      rssi: rssi?.[1] != null ? Number.parseInt(rssi[1], 10) : undefined,
      snr: snr?.[1] != null ? Number.parseFloat(snr[1]) : undefined,
      distanceKm: dist?.[1] != null ? Number.parseFloat(dist[1]) : undefined,
    });
  }
  return out;
}
