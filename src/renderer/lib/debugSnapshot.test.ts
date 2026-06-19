import { beforeEach, describe, expect, it } from 'vitest';

import { addIdentity, setActiveIdentity, useIdentityStore } from '../stores/identityStore';
import { upsertMessage } from '../stores/messageStore';
import { buildDebugSnapshot } from './debugSnapshot';
import {
  ensureOfflineProtocolIdentities,
  OFFLINE_MESHCORE_IDENTITY_ID,
} from './offlineProtocolIdentities';
import { meshcoreProtocol } from './protocols/MeshCoreProtocol';

describe('buildDebugSnapshot', () => {
  beforeEach(() => {
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
  });

  it('includes resolved and primary identity bucket counts', () => {
    ensureOfflineProtocolIdentities();
    const connectedId = 'id-mc-debug';
    addIdentity({
      id: connectedId,
      protocol: meshcoreProtocol,
      signature: 'meshcore:debug',
      transports: [
        {
          transportId: 't1',
          type: 'ble',
          status: 'connected',
          params: { type: 'ble', peripheralId: 'debug-ble' },
        },
      ],
      createdAt: 10,
      lastSeenAt: 10,
    });
    setActiveIdentity(connectedId);
    upsertMessage(connectedId, {
      id: 'snap-1',
      from: 1,
      to: 0,
      payload: 'test',
      channelIndex: 30,
      timestamp: 1_700_000_000_000,
    });

    const snap = buildDebugSnapshot();
    expect(snap.meshcore.primaryId).toBe(connectedId);
    expect(snap.meshcore.resolvedId).toBe(connectedId);
    expect(snap.meshcore.primaryMessageCount).toBe(1);
    expect(snap.meshcore.primaryNewestMessageTs).toBe(1_700_000_000_000);
    expect(snap.meshcore.offlineId).toBe(OFFLINE_MESHCORE_IDENTITY_ID);
  });
});
