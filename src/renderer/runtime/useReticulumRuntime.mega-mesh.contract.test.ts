/**
 * Source contract: large/mega-mesh peer refresh cadence and diagnostics dedupe.
 */
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useReticulumRuntime.ts');

describe('useReticulumRuntime mega-mesh / proxy thrash guards (source contract)', () => {
  it('uses 120s large-mesh peer refresh and does not accelerate LXMF catch-up', () => {
    expect(SOURCE).toMatch(/RETICULUM_PEER_REFRESH_LARGE_MS\s*=\s*120_000/);
    expect(SOURCE).toMatch(/RETICULUM_INBOUND_LXMF_CATCHUP_MS\s*=\s*60_000/);
    expect(SOURCE).not.toMatch(/RETICULUM_INBOUND_LXMF_CATCHUP_LARGE_MS/);
  });

  it('skips warm mega-mesh periodic full peer dumps within the max age window', () => {
    expect(SOURCE).toContain('MEGA_MESH_NODE_THRESHOLD');
    expect(SOURCE).toContain('MEGA_MESH_FULL_PEER_REFRESH_MAX_AGE_MS');
    expect(SOURCE).toMatch(
      /count > MEGA_MESH_NODE_THRESHOLD[\s\S]*?Date\.now\(\) - lastRefreshAt < MEGA_MESH_FULL_PEER_REFRESH_MAX_AGE_MS/,
    );
    expect(SOURCE).toMatch(/skipNomad:\s*count > LARGE_MESH_NODE_THRESHOLD/);
  });

  it('passes prefetched health into diagnostics and skips diagnostics on large-mesh health ticks', () => {
    expect(SOURCE).toMatch(/prefetchedHealth\?:/);
    expect(SOURCE).toMatch(/prefetchedHealth\s*\?\s*Promise\.resolve\(prefetchedHealth\)/);
    expect(SOURCE).toMatch(
      /peerCount <= LARGE_MESH_NODE_THRESHOLD[\s\S]*?syncDiagnosticsFromSidecar\(health\)/,
    );
  });

  it('backs off local interface polls on IPC rate-limit errors', () => {
    expect(SOURCE).toContain('isReticulumSidecarRateLimitError');
    expect(SOURCE).toMatch(
      /isReticulumSidecarRateLimitError\(e\)[\s\S]*?RETICULUM_LOCAL_HEALTH_POLL_MS/,
    );
  });

  it('does not invalidate the interfaces cache on every health refresh', () => {
    const refreshBody =
      /const refreshLocalInterfacesFromSidecar = useCallback\(async \(\) => \{([\s\S]*?)\}, \[\]\);/.exec(
        SOURCE,
      )?.[1];
    expect(refreshBody).toBeTruthy();
    expect(refreshBody).not.toContain('invalidateReticulumInterfacesCache');
  });
});
