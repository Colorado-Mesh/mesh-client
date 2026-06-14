import { normalizeLastHeardMs } from './nodeStatus';
import { MS_PER_HOUR } from './timeConstants';
import type { MeshNode } from './types';

export interface NodeHealthBreakdown {
  signal: number;
  recency: number;
  load: number;
  battery: number;
  total: number;
}

export function nodeHealthScore(node: MeshNode, nowMs: number = Date.now()): NodeHealthBreakdown {
  // Signal: SNR normalized to 0–40 pts (range -20 to +20 dB)
  const snr = node.snr ?? -20;
  const signal = Math.round(Math.min(40, Math.max(0, ((snr + 20) / 40) * 40)));

  // Recency: 30 pts if heard < 1h, 15 if < 6h, 0 otherwise
  const lastHeardMs = normalizeLastHeardMs(node.last_heard ?? 0);
  const ageMs = nowMs - lastHeardMs;
  const recency =
    lastHeardMs === 0 ? 0 : ageMs < MS_PER_HOUR ? 30 : ageMs < 6 * MS_PER_HOUR ? 15 : 0;

  // Load: channel_utilization inverted, 0–20 pts
  const cu = node.channel_utilization ?? 0;
  const load = Math.round(Math.max(0, 20 - (cu / 100) * 20));

  // Battery: 0–10 pts; only counted when available (> 0)
  const batt = node.battery ?? 0;
  const battery = batt > 0 ? Math.round((batt / 100) * 10) : 0;

  const total = signal + recency + load + battery;

  return { signal, recency, load, battery, total };
}

export type NodeHealthTier = 'good' | 'warn' | 'poor';

export function nodeHealthTier(total: number): NodeHealthTier {
  if (total >= 70) return 'good';
  if (total >= 40) return 'warn';
  return 'poor';
}
