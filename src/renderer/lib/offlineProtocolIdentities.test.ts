import { beforeEach, describe, expect, it } from 'vitest';

import { useIdentityStore } from '../stores/identityStore';
import { getIdentityIdForProtocol } from './identityByProtocol';
import {
  ensureOfflineProtocolIdentities,
  getOfflineIdentityIdForProtocol,
  OFFLINE_MESHCORE_IDENTITY_ID,
  OFFLINE_MESHTASTIC_IDENTITY_ID,
  tryReuseOfflineProtocolIdentity,
} from './offlineProtocolIdentities';

describe('offlineProtocolIdentities', () => {
  beforeEach(() => {
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
  });

  it('creates stable offline identities for both protocols', () => {
    ensureOfflineProtocolIdentities();
    const state = useIdentityStore.getState();
    expect(state.identities[OFFLINE_MESHTASTIC_IDENTITY_ID]).toBeDefined();
    expect(state.identities[OFFLINE_MESHCORE_IDENTITY_ID]).toBeDefined();
    expect(getIdentityIdForProtocol('meshtastic')).toBe(OFFLINE_MESHTASTIC_IDENTITY_ID);
    expect(getIdentityIdForProtocol('meshcore')).toBe(OFFLINE_MESHCORE_IDENTITY_ID);
  });

  it('tryReuseOfflineProtocolIdentity returns offline id before connect', () => {
    ensureOfflineProtocolIdentities();
    expect(tryReuseOfflineProtocolIdentity('meshtastic')).toBe(OFFLINE_MESHTASTIC_IDENTITY_ID);
    expect(getOfflineIdentityIdForProtocol('meshcore')).toBe(OFFLINE_MESHCORE_IDENTITY_ID);
  });
});
