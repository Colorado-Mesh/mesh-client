import { beforeEach, describe, expect, it } from 'vitest';

import { addIdentity, setActiveIdentity, useIdentityStore } from '../stores/identityStore';
import { getIdentityIdForProtocol } from './identityByProtocol';
import { meshcoreProtocol } from './protocols/MeshCoreProtocol';
import { meshtasticProtocol } from './protocols/MeshtasticProtocol';

describe('getIdentityIdForProtocol', () => {
  beforeEach(() => {
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
  });

  it('prefers active identity when it matches the protocol', () => {
    addIdentity({
      id: 'id-mt-old',
      protocol: meshtasticProtocol,
      signature: 'a',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    addIdentity({
      id: 'id-mt-new',
      protocol: meshtasticProtocol,
      signature: 'b',
      transports: [],
      createdAt: 2,
      lastSeenAt: 2,
    });
    setActiveIdentity('id-mt-new');
    expect(getIdentityIdForProtocol('meshtastic')).toBe('id-mt-new');
  });

  it('returns earliest-created identity when active identity is another protocol', () => {
    addIdentity({
      id: 'id-mt',
      protocol: meshtasticProtocol,
      signature: 'a',
      transports: [],
      createdAt: 10,
      lastSeenAt: 1,
    });
    addIdentity({
      id: 'id-mc',
      protocol: meshcoreProtocol,
      signature: 'b',
      transports: [],
      createdAt: 5,
      lastSeenAt: 1,
    });
    setActiveIdentity('id-mc');
    expect(getIdentityIdForProtocol('meshtastic')).toBe('id-mt');
  });
});
