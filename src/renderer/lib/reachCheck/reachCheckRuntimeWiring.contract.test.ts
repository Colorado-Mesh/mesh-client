import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../sourceContractTestHelpers';

describe('reach check runtime wiring (source contract)', () => {
  it('clears reach check entries, and so their pollers, when the MeshCore identity disconnects', () => {
    const source = loadRuntimeSource('useMeshcoreRuntime.ts');
    const relayClear = source.indexOf(
      'useRelayCoverageStore.getState().clearIdentity(coverageIdentity);',
    );
    const reachClear = source.indexOf(
      'useReachCheckStore.getState().clearIdentity(coverageIdentity);',
    );
    expect(relayClear).toBeGreaterThan(-1);
    expect(reachClear).toBeGreaterThan(relayClear);
    // Same `if (coverageIdentity)` block: nothing but a comment between the two calls.
    const between = source.slice(relayClear, reachClear).split('\n').slice(1, -1);
    expect(between.every((line) => line.trim() === '' || line.trim().startsWith('//'))).toBe(true);
  });
});
