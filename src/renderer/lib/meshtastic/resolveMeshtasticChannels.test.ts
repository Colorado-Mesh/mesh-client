import { describe, expect, it } from 'vitest';

import { resolveMeshtasticChannels } from './resolveMeshtasticChannels';

describe('resolveMeshtasticChannels', () => {
  const REAL = [
    { index: 0, name: 'General' },
    { index: 3, name: 'Ops' },
  ];
  const PLACEHOLDER = [{ index: 0, name: 'Primary' }];

  it('returns the device record channels when present', () => {
    expect(
      resolveMeshtasticChannels({
        meshtasticIdentityId: 'id-1',
        deviceRecordChannels: REAL,
        hookChannels: PLACEHOLDER,
        lastKnownChannels: [],
      }),
    ).toBe(REAL);
  });

  it('bridges the disconnect→rebind gap with the last known list when identity is null', () => {
    expect(
      resolveMeshtasticChannels({
        meshtasticIdentityId: null,
        deviceRecordChannels: undefined,
        hookChannels: PLACEHOLDER,
        lastKnownChannels: REAL,
      }),
    ).toBe(REAL);
  });

  it('falls back to the hook placeholder when identity is null and nothing was ever cached', () => {
    expect(
      resolveMeshtasticChannels({
        meshtasticIdentityId: null,
        deviceRecordChannels: undefined,
        hookChannels: PLACEHOLDER,
        lastKnownChannels: [],
      }),
    ).toBe(PLACEHOLDER);
  });

  it('does not use the stale cache once a real identity is bound but its own record has no channels yet', () => {
    // A genuinely new/different device connecting: identityId is set, but its
    // deviceStore record hasn't received channel data yet. Must show the
    // generic placeholder, not another device's cached channel list.
    expect(
      resolveMeshtasticChannels({
        meshtasticIdentityId: 'id-2',
        deviceRecordChannels: [],
        hookChannels: PLACEHOLDER,
        lastKnownChannels: REAL,
      }),
    ).toBe(PLACEHOLDER);
  });

  it('prefers the device record over the cache even mid-gap once it repopulates', () => {
    const updated = [{ index: 5, name: 'New' }];
    expect(
      resolveMeshtasticChannels({
        meshtasticIdentityId: null,
        deviceRecordChannels: updated,
        hookChannels: PLACEHOLDER,
        lastKnownChannels: REAL,
      }),
    ).toBe(updated);
  });
});
