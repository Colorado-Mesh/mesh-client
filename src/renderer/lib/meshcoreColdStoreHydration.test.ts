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

  it('starts false and flips after mark', () => {
    expect(hasMeshcoreColdStoreHydrated()).toBe(false);
    markMeshcoreColdStoreHydrated();
    expect(hasMeshcoreColdStoreHydrated()).toBe(true);
  });
});
