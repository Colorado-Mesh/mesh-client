import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeCuStats24h, useDiagnosticsStore } from './diagnosticsStore';

const SNAPSHOT_KEY = 'mesh-client:diagnosticRowsSnapshot';

describe('diagnosticsStore clearing behavior', () => {
  beforeEach(() => {
    localStorage.removeItem(SNAPSHOT_KEY);
    useDiagnosticsStore.getState().clearDiagnostics();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem(SNAPSHOT_KEY);
    useDiagnosticsStore.getState().clearDiagnostics();
  });

  it('clearDiagnostics clears in-memory rows and persisted snapshot', () => {
    useDiagnosticsStore.setState({
      diagnosticRows: [
        {
          kind: 'routing',
          id: 'routing:1',
          nodeId: 1,
          type: 'bad_route',
          severity: 'warning',
          description: 'stale routing row',
          detectedAt: Date.now(),
        },
      ],
      diagnosticRowsRestoredAt: Date.now(),
    });
    localStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({
        v: 1,
        savedAt: Date.now(),
        rows: useDiagnosticsStore.getState().diagnosticRows,
      }),
    );

    useDiagnosticsStore.getState().clearDiagnostics();

    const state = useDiagnosticsStore.getState();
    expect(state.diagnosticRows).toEqual([]);
    expect(state.diagnosticRowsRestoredAt).toBeNull();
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });

  it('clearDiagnostics with preserveForeignLora keeps foreign LoRa detections', () => {
    useDiagnosticsStore
      .getState()
      .recordForeignLora(42, 'meshcore', -55, 9, 0xabc, undefined, 'meshtastic-rf');
    expect(useDiagnosticsStore.getState().foreignLoraDetections.get(42)?.size).toBe(1);

    useDiagnosticsStore.getState().clearDiagnostics({ preserveForeignLora: true });

    const state = useDiagnosticsStore.getState();
    expect(state.diagnosticRows).toEqual([]);
    expect(state.foreignLoraDetections.get(42)?.size).toBe(1);
  });

  it('clearDiagnosticRowsSnapshot cancels pending snapshot persistence timer', () => {
    vi.useFakeTimers();

    useDiagnosticsStore
      .getState()
      .recordForeignLora(1, 'meshcore', -70, 12, undefined, undefined, 'meshtastic-rf');
    useDiagnosticsStore.getState().clearDiagnosticRowsSnapshot();

    vi.advanceTimersByTime(3_000);

    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });
});

describe('computeCuStats24h', () => {
  it('returns null for empty samples', () => {
    expect(computeCuStats24h([])).toBeNull();
  });

  it('returns null when all samples are older than 24h', () => {
    const old = Date.now() - 25 * 60 * 60 * 1000;
    expect(computeCuStats24h([{ t: old, cu: 10 }])).toBeNull();
  });

  it('computes average and span for fresh samples', () => {
    const now = Date.now();
    const samples = [
      { t: now - 60_000, cu: 10 },
      { t: now - 120_000, cu: 20 },
      { t: now - 180_000, cu: 30 },
    ];
    const result = computeCuStats24h(samples);
    expect(result).not.toBeNull();
    expect(result!.sampleCount).toBe(3);
    expect(result!.average).toBeCloseTo(20);
    expect(result!.spanMs).toBeGreaterThan(0);
  });

  it('prunes samples older than 24h before computing', () => {
    const now = Date.now();
    const samples = [
      { t: now - 25 * 60 * 60 * 1000, cu: 100 },
      { t: now - 1000, cu: 10 },
    ];
    const result = computeCuStats24h(samples);
    expect(result).not.toBeNull();
    expect(result!.sampleCount).toBe(1);
    expect(result!.average).toBe(10);
  });

  it('returns spanMs of 0 for a single sample', () => {
    const now = Date.now();
    const result = computeCuStats24h([{ t: now - 1000, cu: 15 }]);
    expect(result).not.toBeNull();
    expect(result!.spanMs).toBe(0);
    expect(result!.sampleCount).toBe(1);
  });
});
