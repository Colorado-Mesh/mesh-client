import { beforeEach, describe, expect, it } from 'vitest';

import type { Protocol } from '../lib/protocols/Protocol';
import {
  addIdentity,
  getIdentity,
  replaceIdentityProtocol,
  useIdentityStore,
} from './identityStore';

const stubA = { type: 'meshcom', capabilities: {} } as Protocol;
const stubB = { type: 'meshcom', capabilities: { protocol: 'meshcom' } } as Protocol;

describe('replaceIdentityProtocol', () => {
  beforeEach(() => {
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
  });

  it('swaps the protocol adapter on an existing identity', () => {
    addIdentity({
      id: 'offline-meshcom',
      protocol: stubA,
      signature: '',
      transports: [],
      createdAt: 0,
      lastSeenAt: 0,
    });
    replaceIdentityProtocol('offline-meshcom', stubB);
    expect(getIdentity('offline-meshcom')?.protocol).toBe(stubB);
  });

  it('no-ops when the identity is missing', () => {
    replaceIdentityProtocol('missing', stubB);
    expect(getIdentity('missing')).toBeNull();
  });
});
