import { MS_PER_SECOND } from '../shared/timeConstants';

/** Drop a pending write→data sample if no data arrives within this window. */
export const LIVE_SESSION_PENDING_SAMPLE_TIMEOUT_MS = 3 * MS_PER_SECOND;

/** Hide bars when no completed sample within this window. */
export const LIVE_SESSION_STALE_MS = 15 * MS_PER_SECOND;

/** EWMA smoothing factor for write→first-data latency samples. */
export const LIVE_SESSION_EWMA_ALPHA = 0.3;

export type LiveSessionMeterProtocol = 'meshtastic' | 'meshcore';

export interface LiveSessionMeterSnapshot {
  rttMs: number | null;
}

export interface LiveSessionMeter {
  noteWrite: () => void;
  noteData: () => void;
  reset: () => void;
  clear: () => void;
  snapshot: () => LiveSessionMeterSnapshot;
}

export interface LiveSessionMeterOptions {
  now?: () => number;
  alpha?: number;
  pendingTimeoutMs?: number;
  staleMs?: number;
}

/**
 * Passive link-quality meter for an already-open TCP session.
 * Samples write→first-data latency (EWMA); never opens a second connection.
 */
export function createLiveSessionMeter(opts: LiveSessionMeterOptions = {}): LiveSessionMeter {
  const nowFn = opts.now ?? Date.now;
  const alpha = opts.alpha ?? LIVE_SESSION_EWMA_ALPHA;
  const pendingTimeoutMs = opts.pendingTimeoutMs ?? LIVE_SESSION_PENDING_SAMPLE_TIMEOUT_MS;
  const staleMs = opts.staleMs ?? LIVE_SESSION_STALE_MS;

  let active = true;
  let ewmaMs: number | null = null;
  let lastSampleAt: number | null = null;
  let pendingWriteAt: number | null = null;

  const dropStalePending = (now: number): void => {
    if (pendingWriteAt != null && now - pendingWriteAt > pendingTimeoutMs) {
      pendingWriteAt = null;
    }
  };

  return {
    noteWrite(): void {
      if (!active) return;
      pendingWriteAt = nowFn();
    },

    noteData(): void {
      if (!active) return;
      const now = nowFn();
      dropStalePending(now);
      if (pendingWriteAt == null) return;
      const sample = now - pendingWriteAt;
      pendingWriteAt = null;
      if (!Number.isFinite(sample) || sample < 0) return;
      ewmaMs = ewmaMs == null ? sample : alpha * sample + (1 - alpha) * ewmaMs;
      lastSampleAt = now;
    },

    reset(): void {
      active = true;
      ewmaMs = null;
      lastSampleAt = null;
      pendingWriteAt = null;
    },

    clear(): void {
      active = false;
      ewmaMs = null;
      lastSampleAt = null;
      pendingWriteAt = null;
    },

    snapshot(): LiveSessionMeterSnapshot {
      if (!active || ewmaMs == null || lastSampleAt == null) {
        return { rttMs: null };
      }
      const now = nowFn();
      if (now - lastSampleAt > staleMs) {
        return { rttMs: null };
      }
      return { rttMs: ewmaMs };
    },
  };
}

/** Registry of active meters keyed by protocol (at most one live TCP session each). */
const meters = new Map<LiveSessionMeterProtocol, LiveSessionMeter>();

export function resetLiveSessionMeter(protocol: LiveSessionMeterProtocol): LiveSessionMeter {
  const existing = meters.get(protocol);
  if (existing) {
    existing.reset();
    return existing;
  }
  const meter = createLiveSessionMeter();
  meters.set(protocol, meter);
  return meter;
}

export function getLiveSessionMeter(protocol: LiveSessionMeterProtocol): LiveSessionMeter | null {
  return meters.get(protocol) ?? null;
}

export function clearLiveSessionMeter(protocol: LiveSessionMeterProtocol): void {
  const meter = meters.get(protocol);
  if (!meter) return;
  meter.clear();
  meters.delete(protocol);
}

export function noteLiveSessionWrite(protocol: LiveSessionMeterProtocol): void {
  meters.get(protocol)?.noteWrite();
}

export function noteLiveSessionData(protocol: LiveSessionMeterProtocol): void {
  meters.get(protocol)?.noteData();
}

export function snapshotLiveSessionMeter(
  protocol: LiveSessionMeterProtocol,
): LiveSessionMeterSnapshot | null {
  const meter = meters.get(protocol);
  if (!meter) return null;
  return meter.snapshot();
}

/** Test-only: drop all registered meters. */
export function __resetLiveSessionMeterRegistryForTests(): void {
  for (const meter of meters.values()) {
    meter.clear();
  }
  meters.clear();
}
