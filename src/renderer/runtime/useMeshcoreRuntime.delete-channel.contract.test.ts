// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useMeshcoreRuntime.ts');

describe('useMeshcoreRuntime deleteMeshcoreChannel', () => {
  it('passes a failed delete back to the caller, which says so on screen', () => {
    const start = SOURCE.indexOf('const deleteMeshcoreChannel = useCallback(');
    expect(start).toBeGreaterThan(-1);
    const body = SOURCE.slice(start, SOURCE.indexOf('[runMeshcoreUserTxWithLiveTcp]', start));
    // Logged, then rethrown: chat and Device > Radio > Channels both catch it.
    expect(body).toMatch(/catch \(e\) \{[\s\S]*console\.warn\([\s\S]*throw e;\s*\}/);
  });
});
