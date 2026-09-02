import { beforeEach, describe, expect, it } from 'vitest';

import {
  beginIdentityHydration,
  resetIdentityHydrationCoordinatorForTests,
  sameIdentityRefreshSession,
} from './identityHydrationCoordinator';

const ID = 'id-hydrate-coord';

describe('identityHydrationCoordinator', () => {
  beforeEach(() => {
    resetIdentityHydrationCoordinatorForTests();
  });

  it('marks earlier hydration passes stale when superseded', () => {
    const first = beginIdentityHydration('meshtastic', ID);
    const second = beginIdentityHydration('meshtastic', ID);
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('sameIdentityRefreshSession requires matching identity and generation', () => {
    expect(
      sameIdentityRefreshSession(
        { identityId: 'a', generation: 1 },
        { identityId: 'a', generation: 1 },
      ),
    ).toBe(true);
    expect(
      sameIdentityRefreshSession(
        { identityId: 'a', generation: 1 },
        { identityId: 'b', generation: 1 },
      ),
    ).toBe(false);
    expect(
      sameIdentityRefreshSession(
        { identityId: 'a', generation: 1 },
        { identityId: 'a', generation: 2 },
      ),
    ).toBe(false);
  });
});
