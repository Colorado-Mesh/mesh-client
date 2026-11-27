import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../sourceContractTestHelpers';

describe('reach check runtime wiring (source contract)', () => {
  it('leaves reach check entries alone when the MeshCore link is torn down', () => {
    // teardownMeshcoreConnEventListeners also runs for an OpenHop/pyMC quiet reopen before each
    // user send, so clearing there removed a check's line and stopped its polling right after the
    // code went out. A check now ends with its session; lines are keyed by identity.
    const source = loadRuntimeSource('useMeshcoreRuntime.ts');
    expect(source).toContain('useRelayCoverageStore.getState().clearIdentity(coverageIdentity);');
    expect(source).not.toContain('useReachCheckStore');
  });
});
