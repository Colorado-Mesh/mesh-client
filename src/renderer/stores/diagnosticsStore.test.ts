import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDiagnosticsStore } from './diagnosticsStore';

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

  it('clearDiagnosticRowsSnapshot cancels pending snapshot persistence timer', () => {
    vi.useFakeTimers();

    useDiagnosticsStore.getState().recordForeignLora(1, 'meshcore', -70, 12);
    useDiagnosticsStore.getState().clearDiagnosticRowsSnapshot();

    vi.advanceTimersByTime(3_000);

    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });
});
