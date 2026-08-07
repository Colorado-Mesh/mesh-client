import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { useReticulumPropagationStore } from '../../stores/reticulumPropagationStore';
import type { DiagnosticRow } from '../types';
import {
  buildReticulumDiagnosticSnapshotSync,
  fetchReticulumDiagnosticSnapshot,
} from './reticulumDiagnosticSnapshot';
import { RETICULUM_PROPAGATION_MODE_KEY } from './reticulumPropagationMode';

function reticulumRow(condition: string): DiagnosticRow {
  return {
    kind: 'rf',
    id: `rf:1:reticulum/${condition}`,
    nodeId: 1,
    condition: `reticulum/${condition}`,
    cause: 'test',
    severity: 'warning',
    detectedAt: Date.now(),
  };
}

describe('fetchReticulumDiagnosticSnapshot', () => {
  beforeEach(() => {
    useDiagnosticsStore.setState({ diagnosticRows: [reticulumRow('audit/tcp_enable_key')] });
    vi.mocked(window.electronAPI.reticulum.getStatus).mockReset();
    vi.mocked(window.electronAPI.reticulum.proxyGet).mockReset();
  });

  it('records getStatus failure and omits stack when sidecar is down', async () => {
    vi.mocked(window.electronAPI.reticulum.getStatus).mockRejectedValue(new Error('IPC failed'));

    const snap = await fetchReticulumDiagnosticSnapshot();

    expect(snap.sidecar).toEqual({ running: false, port: 0, pid: null });
    expect(snap.stack).toBeNull();
    expect(snap.fetchErrors.getStatus).toBe('IPC failed');
    expect(snap.fetchErrors['/api/v1/status']).toBe('sidecar not running');
    expect(snap.diagnosticRows).toHaveLength(1);
    expect(window.electronAPI.reticulum.proxyGet).not.toHaveBeenCalled();
  });

  it('fetches sidecar APIs when running and captures per-route errors', async () => {
    vi.mocked(window.electronAPI.reticulum.getStatus).mockResolvedValue({
      running: true,
      port: 19437,
      pid: 42,
    });
    vi.mocked(window.electronAPI.reticulum.proxyGet).mockImplementation((path: string) => {
      if (path === '/api/v1/status') {
        return Promise.resolve({
          status: 'ok',
          version: '1.0',
          rns_ready: true,
          lxmf_ready: true,
        });
      }
      if (path === '/api/v1/identity/status') {
        return Promise.resolve({
          configured: true,
          identity_hash: 'aa'.repeat(16),
          lxmf_hash: 'bb'.repeat(16),
        });
      }
      if (path === '/api/v1/config/audit') {
        return Promise.reject(new Error('audit unavailable'));
      }
      return Promise.resolve({ ok: true });
    });

    const snap = await fetchReticulumDiagnosticSnapshot();

    expect(snap.sidecar.running).toBe(true);
    expect(snap.stack?.status?.rns_ready).toBe(true);
    expect(snap.stack?.identityStatus?.configured).toBe(true);
    expect(snap.fetchErrors['/api/v1/config/audit']).toBe('audit unavailable');
    expect(snap.diagnosticRows).toHaveLength(1);
    expect(window.electronAPI.reticulum.proxyGet).toHaveBeenCalledWith('/api/v1/diagnostics');
  });
});

describe('buildReticulumDiagnosticSnapshotSync', () => {
  afterEach(() => {
    localStorage.removeItem(RETICULUM_PROPAGATION_MODE_KEY);
  });

  it('includes diagnostic rows without sidecar IPC', () => {
    useDiagnosticsStore.setState({ diagnosticRows: [reticulumRow('runtime/rnsNotReady')] });

    const snap = buildReticulumDiagnosticSnapshotSync();

    expect(snap.sidecar.running).toBe(false);
    expect(snap.stack).toBeNull();
    expect(snap.diagnosticRows).toHaveLength(1);
    expect(snap.fetchErrors).toEqual({});
  });

  it('captures renderer propagation client state for PN island diagnosis', () => {
    localStorage.setItem(RETICULUM_PROPAGATION_MODE_KEY, 'manual');
    useReticulumPropagationStore.setState({
      nodes: [
        { id: 'local-prop', name: 'Local', enabled: true, status: 'known', hops: 0 },
        { id: 'pn-0e972735', name: 'Remote', enabled: true, status: 'known', hops: 2 },
      ],
      discovered: [],
      preferredId: 'pn-0e972735',
      lastSyncError: 'reticulumPropagation.syncFailed',
      autoSyncIntervalSec: 3600,
    });

    const snap = buildReticulumDiagnosticSnapshotSync();

    expect(snap.propagationClient?.mode).toBe('manual');
    expect(snap.propagationClient?.preferredId).toBe('pn-0e972735');
    expect(snap.propagationClient?.resolvedSyncTargetId).toBe('pn-0e972735');
    expect(snap.propagationClient?.autoTarget).toBe('configured:pn-0e972735');
    expect(snap.propagationClient?.lastSyncError).toBe('reticulumPropagation.syncFailed');
    expect(snap.propagationClient?.nodeCount).toBe(2);
  });
});
