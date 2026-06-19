import { beforeEach, describe, expect, it } from 'vitest';

import { upsertMessage, useMessageStore } from '../stores/messageStore';
import { upsertNode, useNodeStore } from '../stores/nodeStore';
import { mergeOfflineStoreIntoIdentity } from './mergeOfflineIdentityStore';
import {
  ensureOfflineProtocolIdentities,
  OFFLINE_MESHCORE_IDENTITY_ID,
} from './offlineProtocolIdentities';

describe('mergeOfflineStoreIntoIdentity', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    useNodeStore.setState({ nodes: {} });
  });

  it('copies offline messages and nodes into target identity', () => {
    ensureOfflineProtocolIdentities();
    const targetId = 'id-mc-target';
    upsertNode(OFFLINE_MESHCORE_IDENTITY_ID, { nodeId: 42, longName: 'Contact' });
    upsertMessage(OFFLINE_MESHCORE_IDENTITY_ID, {
      id: 'msg-offline',
      from: 42,
      to: 0,
      payload: 'hello',
      channelIndex: 30,
      timestamp: 1,
    });

    mergeOfflineStoreIntoIdentity('meshcore', targetId);

    expect(useNodeStore.getState().nodes[targetId]?.[42]?.longName).toBe('Contact');
    expect(useMessageStore.getState().messages[targetId]?.['msg-offline']?.payload).toBe('hello');
  });

  it('no-ops when target is the offline slot', () => {
    ensureOfflineProtocolIdentities();
    upsertMessage(OFFLINE_MESHCORE_IDENTITY_ID, {
      id: 'msg-only-offline',
      from: 1,
      to: 0,
      payload: 'stay',
      channelIndex: 0,
      timestamp: 1,
    });
    mergeOfflineStoreIntoIdentity('meshcore', OFFLINE_MESHCORE_IDENTITY_ID);
    expect(Object.keys(useMessageStore.getState().messages)).toEqual([
      OFFLINE_MESHCORE_IDENTITY_ID,
    ]);
  });
});
