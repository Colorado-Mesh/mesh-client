import { beforeEach, describe, expect, it } from 'vitest';

import {
  beginIdentityHydration,
  resetIdentityHydrationCoordinatorForTests,
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
});
