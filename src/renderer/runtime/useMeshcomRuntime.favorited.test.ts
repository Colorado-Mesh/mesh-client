// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useMeshcomRuntime.ts');

describe('useMeshcomRuntime setNodeFavorited', () => {
  it('persists favorited via saveMeshcomContact (not a no-op stub)', () => {
    expect(SOURCE).toMatch(/saveMeshcomContact\(/);
    expect(SOURCE).toMatch(/patchNodeFavorited\(/);
    expect(SOURCE).not.toMatch(/setNodeFavorited:\s*async\s*\(\)\s*=>\s*\{\s*\}/);
  });
});
