import { describe, expect, it, vi } from 'vitest';

import { ANALYSIS_WORKER_REQUEST_TIMEOUT_MS } from '../timeConstants';
import { runAnalysisJob, runTopologyBuildJob } from './analysisJobHandlers';
import { createAnalysisWorkerPool, workerBudget } from './analysisWorkerPool';
import { runDiagnosticsAnalyzeBatchInline } from './runDiagnosticsAnalyzeBatch';
import { runTopologyBuildInline } from './runTopologyBuild';
import { isAllowedWorkerMessageOrigin } from './workerOrigins';

describe('analysisJobHandlers', () => {
  it('builds topology equal to the inline helper', () => {
    const args = {
      interfaces: [
        {
          id: 'rnode',
          name: 'RNode',
          type: 'RNodeInterface',
          enabled: true,
          status: 'up',
        },
      ],
      peers: [
        {
          destination_hash: 'aabbccdd',
          display_name: 'Peer',
          hops: 1,
          interface: 'RNode',
        },
      ],
      opts: {
        selfLabel: 'Me',
        unassignedInterfaceLabel: 'Unassigned',
        cx: 100,
        cy: 100,
        serverPeerHashes: new Set<string>(),
      },
    };
    const viaJob = runTopologyBuildJob({
      kind: 'topologyBuild',
      sequence: 1,
      interfaces: args.interfaces,
      peers: args.peers,
      opts: { ...args.opts, serverPeerHashes: [] },
    });
    const inline = runTopologyBuildInline(args);
    expect(viaJob.kind).toBe('topologyBuild');
    if (viaJob.kind === 'topologyBuild') {
      expect(viaJob.graph).toEqual(inline);
    }
  });

  it('analyzes a diagnostics batch and clears clean nodes', () => {
    const baseNode = {
      long_name: 'N',
      short_name: 'N',
      hw_model: 'TEST',
      snr: 0,
      battery: 100,
      last_heard: Date.now(),
      latitude: null as number | null,
      longitude: null as number | null,
    };
    const result = runDiagnosticsAnalyzeBatchInline({
      homeNode: { ...baseNode, node_id: 1, hops_away: 0 },
      distanceMultiplier: 1,
      distanceOffsetKm: 0,
      hopsThreshold: 2,
      capabilities: {
        protocol: 'meshtastic',
        hasHopCount: true,
        hasDistanceBasedHopAnomalies: true,
        hasPerHopSnr: false,
      } as const,
      nodes: [
        {
          nodeId: 2,
          node: {
            ...baseNode,
            node_id: 2,
            hops_away: 0,
            latitude: 40,
            longitude: -105,
          },
          hopHistory: [],
          ignoreMqtt: false,
        },
      ],
    });
    expect(result.clearedNodeIds.length + result.anomalies.size).toBe(1);
  });

  it('runAnalysisJob rejects unknown kinds at the type level via default', () => {
    expect(() =>
      runAnalysisJob({
        kind: 'topologyBuild',
        sequence: 0,
        interfaces: [],
        peers: [],
        opts: { selfLabel: 'x', unassignedInterfaceLabel: 'y' },
      }),
    ).not.toThrow();
  });
});

describe('analysisWorkerPool', () => {
  it('sizes worker budget with UI/Catch-up headroom', () => {
    expect(workerBudget(1)).toBe(0);
    expect(workerBudget(2)).toBe(0);
    expect(workerBudget(8)).toBe(2);
    expect(workerBudget(4, 1)).toBe(1);
  });

  it('falls back to inline when workers are disabled', async () => {
    const pool = createAnalysisWorkerPool({
      canUseWorkers: () => false,
      createWorker: () => {
        throw new Error('should not create');
      },
    });
    expect(pool.wouldUseWorker()).toBe(false);
    expect(pool.ensureAttachedWorker()).toBe(false);
    const result = await pool.run({
      kind: 'topologyBuild',
      sequence: 9,
      interfaces: [],
      peers: [],
      opts: { selfLabel: 'Me', unassignedInterfaceLabel: 'Other' },
    });
    expect(result.kind).toBe('topologyBuild');
    pool.dispose();
  });

  it('rejects pending requests that never reply', async () => {
    vi.useFakeTimers();
    try {
      const worker = {
        postMessage: vi.fn(),
        terminate: vi.fn(),
        onmessage: null as ((event: MessageEvent) => void) | null,
        onerror: null as ((event: ErrorEvent) => void) | null,
      };
      const pool = createAnalysisWorkerPool({
        canUseWorkers: () => true,
        hardwareConcurrency: 8,
        createWorker: () => worker as unknown as Worker,
      });
      expect(pool.ensureAttachedWorker()).toBe(true);
      const pending = pool.run({
        kind: 'topologyBuild',
        sequence: 11,
        interfaces: [],
        peers: [],
        opts: { selfLabel: 'Me', unassignedInterfaceLabel: 'Other' },
      });
      const expectation = expect(pending).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(ANALYSIS_WORKER_REQUEST_TIMEOUT_MS);
      await expectation;
      pool.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('workerOrigins', () => {
  it('accepts allowlisted and empty Chromium dedicated-worker origins', () => {
    expect(isAllowedWorkerMessageOrigin('mesh-client://renderer', 'mesh-client://renderer')).toBe(
      true,
    );
    expect(isAllowedWorkerMessageOrigin('', 'mesh-client://renderer')).toBe(true);
    expect(isAllowedWorkerMessageOrigin('https://evil.example', 'mesh-client://renderer')).toBe(
      false,
    );
  });
});
