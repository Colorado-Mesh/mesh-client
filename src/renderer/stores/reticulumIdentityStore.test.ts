import { beforeEach, describe, expect, it } from 'vitest';

import {
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
});
