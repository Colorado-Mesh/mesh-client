import { beforeEach, describe, expect, it } from 'vitest';

import {
  beginReticulumIdentityFetch,
  bumpReticulumIdentityFetchGeneration,
  isReticulumIdentityFetchCurrent,
  resetReticulumIdentityStoreForTests,
  useReticulumIdentityStore,
} from './reticulumIdentityStore';

describe('reticulumIdentityStore', () => {
  beforeEach(() => {
    resetReticulumIdentityStoreForTests();
  });

  it('updates and resets identity status', () => {
    useReticulumIdentityStore.getState().setIdentity({
      configured: true,
      identity_hash: 'identity-hash',
      lxmf_hash: 'lxmf-hash',
      display_name: 'Mesh User',
    });

    expect(useReticulumIdentityStore.getState().identity).toEqual({
      configured: true,
      identity_hash: 'identity-hash',
      lxmf_hash: 'lxmf-hash',
      display_name: 'Mesh User',
    });

    resetReticulumIdentityStoreForTests();

    expect(useReticulumIdentityStore.getState().identity).toBeNull();
  });

  it('invalidates in-flight identity fetch generations', () => {
    const generation = beginReticulumIdentityFetch();
    expect(isReticulumIdentityFetchCurrent(generation)).toBe(true);
    bumpReticulumIdentityFetchGeneration();
    expect(isReticulumIdentityFetchCurrent(generation)).toBe(false);
  });
});
