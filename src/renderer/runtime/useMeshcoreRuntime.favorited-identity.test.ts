// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useMeshcoreRuntime.ts');

describe('useMeshcoreRuntime setNodeFavorited identity bucket', () => {
  it('prefers active connection identity over protocol default bucket', () => {
    expect(SOURCE).toMatch(
      /meshcoreIdentityIdRef\.current \?\? getIdentityIdForProtocol\('meshcore'\)/,
    );
  });
});
