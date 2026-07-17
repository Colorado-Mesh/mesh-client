/**
 * Session-memory types and helpers for Meshtastic module port packets
 * (Pax Counter, Detection Sensor, Range Test).
 */

import { trimArrayTail } from '@/renderer/lib/sessionMemoryCaps';

/** Cap for Pax Counter time-series points per node (session memory). */
export const MAX_PAX_HISTORY_POINTS = 50;

/** Cap for Detection Sensor / Range Test event lists per node. */
export const MAX_MODULE_EVENT_POINTS = 100;

export interface PaxCounterPoint {
  from: number;
  count: number;
  timestamp: number;
}

export interface ModulePortEvent {
  from: number;
  data: Uint8Array;
  timestamp: number;
  /** UTF-8 decoded payload when valid printable text; otherwise undefined. */
  text?: string;
}

export interface RangeTestDecoded {
  sequence?: number;
  snr?: number;
  rssi?: number;
  rawText?: string;
}

/** Decode module payload as UTF-8 text when mostly printable. */
export function decodeModulePortText(data: Uint8Array): string | undefined {
  if (data.length === 0) return undefined;
  try {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(data).replace(/\0/g, '').trim();
    if (!text) return undefined;
    let printable = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) printable++;
    }
    if (printable / text.length < 0.8) return undefined;
    return text;
  } catch {
    // catch-no-log-ok non-fatal decode for display only
    return undefined;
  }
}

export function bytesToHex(data: Uint8Array): string {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

function parseBoundedMetric(
  rawText: string,
  metric: 'snr' | 'rssi',
  maxIntegerDigits: number,
): number | undefined {
  const lower = rawText.toLowerCase();
  const markerIndex = lower.indexOf(metric);
  if (markerIndex < 0) return undefined;

  let cursor = markerIndex + metric.length;
  let separators = 0;
  while (cursor < rawText.length && separators < 8 && '=:\t\r\n '.includes(rawText[cursor] ?? '')) {
    cursor += 1;
    separators += 1;
  }

  const numberStart = cursor;
  if (rawText[cursor] === '-') cursor += 1;
  const integerStart = cursor;
  while (cursor < rawText.length && /\d/.test(rawText[cursor] ?? '')) {
    cursor += 1;
    if (cursor - integerStart > maxIntegerDigits) return undefined;
  }
  if (cursor === integerStart) return undefined;

  if (rawText[cursor] === '.') {
    cursor += 1;
    const decimalStart = cursor;
    while (cursor < rawText.length && /\d/.test(rawText[cursor] ?? '')) {
      cursor += 1;
      if (cursor - decimalStart > 3) return undefined;
    }
  }

  const value = Number(rawText.slice(numberStart, cursor));
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Parse Meshtastic Range Test payload (often plain text with sequence / SNR / RSSI).
 * Best-effort — firmware formats vary.
 */
export function parseRangeTestPayload(data: Uint8Array): RangeTestDecoded {
  const rawText = decodeModulePortText(data);
  if (!rawText) return {};
  const out: RangeTestDecoded = { rawText };
  const seqMatch =
    /\b(?:seq(?:uence)?|msg)[=:\s#]{0,8}(\d{1,10})/i.exec(rawText) ?? /^(\d{1,10})\b/.exec(rawText);
  if (seqMatch) {
    const n = Number(seqMatch[1]);
    if (Number.isFinite(n)) out.sequence = n;
  }
  const snr = parseBoundedMetric(rawText, 'snr', 3);
  if (snr !== undefined) out.snr = snr;
  const rssi = parseBoundedMetric(rawText, 'rssi', 4);
  if (rssi !== undefined) out.rssi = rssi;
  return out;
}

/** Loss rate from observed sequence numbers (0–1). Undefined if <2 sequences. */
export function computeRangeTestLossRate(events: readonly ModulePortEvent[]): number | undefined {
  const sequences: number[] = [];
  for (const ev of events) {
    const decoded = parseRangeTestPayload(ev.data);
    if (decoded.sequence !== undefined) sequences.push(decoded.sequence);
  }
  if (sequences.length < 2) return undefined;
  const min = Math.min(...sequences);
  const max = Math.max(...sequences);
  const span = max - min + 1;
  if (span <= 0) return undefined;
  const unique = new Set(sequences).size;
  const missing = Math.max(0, span - unique);
  return missing / span;
}

export function appendPaxHistory(
  prev: Map<number, PaxCounterPoint[]>,
  point: PaxCounterPoint,
): Map<number, PaxCounterPoint[]> {
  const updated = new Map(prev);
  const existing = updated.get(point.from) ?? [];
  updated.set(point.from, trimArrayTail([...existing, point], MAX_PAX_HISTORY_POINTS));
  return updated;
}

export function appendModulePortEvent(
  prev: Map<number, ModulePortEvent[]>,
  event: ModulePortEvent,
): Map<number, ModulePortEvent[]> {
  const updated = new Map(prev);
  const text = event.text ?? decodeModulePortText(event.data);
  const entry: ModulePortEvent = text !== undefined ? { ...event, text } : { ...event };
  const existing = updated.get(event.from) ?? [];
  updated.set(event.from, trimArrayTail([...existing, entry], MAX_MODULE_EVENT_POINTS));
  return updated;
}

/** Latest Pax point from history map (for scalar “current count” display). */
export function latestPaxPoint(
  history: Map<number, PaxCounterPoint[]> | undefined,
  nodeId: number,
): PaxCounterPoint | undefined {
  const pts = history?.get(nodeId);
  if (!pts || pts.length === 0) return undefined;
  return pts[pts.length - 1];
}
