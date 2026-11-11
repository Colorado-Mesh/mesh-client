import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { meshcoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import { meshtasticProtocol } from '../lib/protocols/MeshtasticProtocol';
import type { Protocol } from '../lib/protocols/Protocol';
import { removeConnection, setConnection, useConnectionStore } from '../stores/connectionStore';
import {
  addIdentity,
  type IdentityRecord,
  setActiveIdentity,
  useIdentityStore,
} from '../stores/identityStore';
import { useConnectionByProtocol } from './useConnectionByProtocol';

function identity(id: string, protocol: Protocol, createdAt: number): IdentityRecord {
  return {
    id,
    protocol,
    signature: `${protocol.type}:${id}`,
    transports: [
      {
        transportId: `t-${id}`,
        type: 'ble',
        status: 'connected',
        params: { type: 'ble', peripheralId: id },
      },
    ],
    createdAt,
    lastSeenAt: createdAt,
  };
}

describe('useConnectionByProtocol', () => {
  beforeEach(() => {
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    useConnectionStore.setState({ connections: {} });
  });

  it('returns null when no identity exists for the protocol', () => {
    const { result } = renderHook(() => useConnectionByProtocol('reticulum'));
    expect(result.current).toBeNull();
  });

  it('returns the connection for the resolved identity', () => {
    addIdentity(identity('mt-1', meshtasticProtocol, 1));
    setConnection('mt-1', { status: 'connected', myNodeNum: 42 });
    const { result } = renderHook(() => useConnectionByProtocol('meshtastic'));
    expect(result.current?.identityId).toBe('mt-1');
    expect(result.current?.status).toBe('connected');
    expect(result.current?.myNodeNum).toBe(42);
  });

  it('ignores identities from other protocols', () => {
    addIdentity(identity('mc-1', meshcoreProtocol, 1));
    setConnection('mc-1', { status: 'connected' });
    const { result } = renderHook(() => useConnectionByProtocol('meshtastic'));
    expect(result.current).toBeNull();
  });

  it('follows the active identity when several share a protocol', () => {
    addIdentity(identity('mc-old', meshcoreProtocol, 1));
    addIdentity(identity('mc-new', meshcoreProtocol, 2));
    setConnection('mc-old', { status: 'disconnected' });
    setConnection('mc-new', { status: 'connected' });
    setActiveIdentity('mc-new');
    const { result } = renderHook(() => useConnectionByProtocol('meshcore'));
    expect(result.current?.identityId).toBe('mc-new');
  });

  it('updates when the connection record is removed', () => {
    addIdentity(identity('mt-1', meshtasticProtocol, 1));
    setConnection('mt-1', { status: 'connected' });
    const { result } = renderHook(() => useConnectionByProtocol('meshtastic'));
    expect(result.current?.status).toBe('connected');
    removeConnection('mt-1');
    const { result: afterRemoval } = renderHook(() => useConnectionByProtocol('meshtastic'));
    expect(afterRemoval.current).toBeNull();
  });
});
