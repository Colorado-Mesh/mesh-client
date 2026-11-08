import { afterEach, describe, expect, it } from 'vitest';

import {
  hasMeshcoreColdStoreHydrated,
  markMeshcoreColdStoreHydrated,
  resetMeshcoreColdStoreHydratedForTests,
} from './meshcoreColdStoreHydration';

describe('meshcoreColdStoreHydration', () => {
  afterEach(() => {
    resetMeshcoreColdStoreHydratedForTests();
  });

  it('starts false and flips after mark for the same identity', () => {
    expect(hasMeshcoreColdStoreHydrated('id-mc')).toBe(false);
    markMeshcoreColdStoreHydrated('id-mc');
    expect(hasMeshcoreColdStoreHydrated('id-mc')).toBe(true);
  });

  it('does not match a different or empty identity', () => {
    markMeshcoreColdStoreHydrated('id-mc');
    expect(hasMeshcoreColdStoreHydrated('id-other')).toBe(false);
    expect(hasMeshcoreColdStoreHydrated(null)).toBe(false);
    expect(hasMeshcoreColdStoreHydrated('')).toBe(false);
    expect(hasMeshcoreColdStoreHydrated()).toBe(false);
  });
});
