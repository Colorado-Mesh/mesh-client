import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ensureOfflineProtocolIdentities,
  OFFLINE_MESHCORE_IDENTITY_ID,
  OFFLINE_RETICULUM_IDENTITY_ID,
} from '../lib/offlineProtocolIdentities';
import { meshcoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import { addIdentity, setActiveIdentity, useIdentityStore } from '../stores/identityStore';
import { upsertMessage } from '../stores/messageStore';
import { upsertNode } from '../stores/nodeStore';
import { useActiveMeshIdentity } from './useActiveMeshIdentity';

describe('useActiveMeshIdentity', () => {
  beforeEach(() => {
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
  });

  it('re-resolves to primary when live messages arrive on connected identity', () => {
    ensureOfflineProtocolIdentities();
    const connectedId = 'id-mc-hook-live';
    addIdentity({
      id: connectedId,
      protocol: meshcoreProtocol,
      signature: 'meshcore:hook',
      transports: [
        {
          transportId: 't1',
          type: 'ble',
          status: 'connected',
          params: { type: 'ble', peripheralId: 'hook-ble' },
        },
      ],
      createdAt: 50,
      lastSeenAt: 50,
    });
    setActiveIdentity(connectedId);
    upsertNode(OFFLINE_MESHCORE_IDENTITY_ID, { nodeId: 1, longName: 'Offline node' });

    const { result, rerender } = renderHook(() => useActiveMeshIdentity('meshcore'));
    expect(result.current.identityIdByProtocol.meshcore).toBe(connectedId);

    act(() => {
      upsertMessage(connectedId, {
        id: 'hook-live-1',
        from: 9,
        to: 0,
        payload: 'incoming',
        channelIndex: 30,
        timestamp: Date.now(),
      });
    });
    rerender();

    expect(result.current.identityIdByProtocol.meshcore).toBe(connectedId);
    expect(result.current.focusedIdentityId).toBe(connectedId);
  });

  it('starts on offline bucket before connect then stays on primary after connect', () => {
    ensureOfflineProtocolIdentities();
    upsertNode(OFFLINE_MESHCORE_IDENTITY_ID, { nodeId: 1, longName: 'DB node' });

    const { result, rerender } = renderHook(() => useActiveMeshIdentity('meshcore'));
    expect(result.current.identityIdByProtocol.meshcore).toBe(OFFLINE_MESHCORE_IDENTITY_ID);

    const connectedId = 'id-mc-after-connect';
    act(() => {
      addIdentity({
        id: connectedId,
        protocol: meshcoreProtocol,
        signature: 'meshcore:after',
        transports: [
          {
            transportId: 't2',
            type: 'ble',
            status: 'connected',
            params: { type: 'ble', peripheralId: 'after-ble' },
          },
        ],
        createdAt: 60,
        lastSeenAt: 60,
      });
      setActiveIdentity(connectedId);
    });
    rerender();

    expect(result.current.identityIdByProtocol.meshcore).toBe(connectedId);
  });

  it('resolves reticulum to its own offline bucket, not meshcore', () => {
    ensureOfflineProtocolIdentities();
    upsertNode(OFFLINE_MESHCORE_IDENTITY_ID, { nodeId: 1, longName: 'MeshCore node' });
    upsertNode(OFFLINE_RETICULUM_IDENTITY_ID, { nodeId: 2, longName: 'Reticulum peer' });

    const { result } = renderHook(() => useActiveMeshIdentity('reticulum'));

    expect(result.current.identityIdByProtocol.reticulum).toBe(OFFLINE_RETICULUM_IDENTITY_ID);
    expect(result.current.identityIdByProtocol.meshcore).toBe(OFFLINE_MESHCORE_IDENTITY_ID);
    expect(result.current.focusedIdentityId).toBe(OFFLINE_RETICULUM_IDENTITY_ID);
    expect(result.current.identityIdByProtocol.reticulum).not.toBe(
      result.current.identityIdByProtocol.meshcore,
    );
  });
});
