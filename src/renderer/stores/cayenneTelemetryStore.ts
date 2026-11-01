/**
 * Session telemetry history decoded from Meshtastic `CAYENNE_APP` packets.
 *
 * Protocol exception: Meshtastic only. Memory-only and bounded (per-series ring, per-node series
 * cap, node cap) — Cayenne LPP is arbitrary sensor data that is not part of firmware
 * `Telemetry`, so there is nothing to hydrate from SQLite.
 *
 * Failure point: none; malformed packets are dropped before reaching the store.
 */
import { create } from 'zustand';

import {
  type CayenneDecodeResult,
  type CayenneKind,
  cayenneSeriesKey,
} from '../lib/meshtastic/cayenneLpp';
import type { IdentityId } from '../lib/types';

export const MAX_CAYENNE_POINTS_PER_SERIES = 200;
export const MAX_CAYENNE_SERIES_PER_NODE = 32;
export const MAX_CAYENNE_NODES = 64;

export interface CayennePoint {
  /** Epoch ms. */
  timestamp: number;
  value: number;
}

export interface CayenneSeries {
  key: string;
  kind: CayenneKind;
  channel: number;
  /** '' for scalars; `x`/`y`/`z`/`lat`/`lon`/`alt` for composite readings. */
  field: string;
  unit: string;
  points: CayennePoint[];
}

export interface CayenneNodeTelemetry {
  nodeNum: number;
  lastHeard: number;
  series: Map<string, CayenneSeries>;
}

interface CayenneState {
  /** identityId → nodeNum → telemetry. */
  byIdentity: Record<IdentityId, Map<number, CayenneNodeTelemetry>>;
}

export const useCayenneTelemetryStore = create<CayenneState>()(() => ({ byIdentity: {} }));

/** Series that are unitless state flags or timestamps do not chart usefully. */
const NON_CHART_KINDS: ReadonlySet<CayenneKind> = new Set(['unixTime']);

export function recordCayennePacket(
  identityId: IdentityId,
  packet: { from: number; timestamp: number; decoded: CayenneDecodeResult },
): void {
  if (packet.decoded.readings.length === 0) return;
  useCayenneTelemetryStore.setState((state) => {
    const nodes = new Map(state.byIdentity[identityId] ?? []);
    const prevNode = nodes.get(packet.from);
    const series = new Map(prevNode?.series ?? []);
    for (const reading of packet.decoded.readings) {
      if (NON_CHART_KINDS.has(reading.kind)) continue;
      for (const [field, value] of Object.entries(reading.values)) {
        const key = cayenneSeriesKey(reading, field);
        const existing = series.get(key);
        if (!existing && series.size >= MAX_CAYENNE_SERIES_PER_NODE) continue;
        const points = [...(existing?.points ?? []), { timestamp: packet.timestamp, value }];
        series.set(key, {
          key,
          kind: reading.kind,
          channel: reading.channel,
          field: field === 'value' ? '' : field,
          unit: reading.unit,
          points:
            points.length > MAX_CAYENNE_POINTS_PER_SERIES
              ? points.slice(points.length - MAX_CAYENNE_POINTS_PER_SERIES)
              : points,
        });
      }
    }
    nodes.delete(packet.from);
    nodes.set(packet.from, { nodeNum: packet.from, lastHeard: packet.timestamp, series });
    while (nodes.size > MAX_CAYENNE_NODES) {
      const oldest = nodes.keys().next().value;
      if (oldest === undefined) break;
      nodes.delete(oldest);
    }
    return { byIdentity: { ...state.byIdentity, [identityId]: nodes } };
  });
}

export function clearCayenneTelemetry(identityId: IdentityId): void {
  useCayenneTelemetryStore.setState((state) => {
    if (!(identityId in state.byIdentity)) return state;
    const next = Object.fromEntries(
      Object.entries(state.byIdentity).filter(([id]) => id !== identityId),
    );
    return { byIdentity: next };
  });
}
