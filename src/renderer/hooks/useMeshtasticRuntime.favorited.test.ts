import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ensureOfflineProtocolIdentities,
  OFFLINE_MESHTASTIC_IDENTITY_ID,
} from '../lib/offlineProtocolIdentities';
import { useMeshtasticRuntime } from '../runtime/useMeshtasticRuntime';
import { upsertNode, useNodeStore } from '../stores/nodeStore';

const NODE_ID = 0x42424242;

describe('useMeshtasticRuntime setNodeFavorited', () => {
  beforeEach(() => {
    ensureOfflineProtocolIdentities();
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
  });

  it('updates nodeStore when node exists only in the UI store bucket', async () => {
    upsertNode(OFFLINE_MESHTASTIC_IDENTITY_ID, { nodeId: NODE_ID, longName: 'Node B' });

    const { result } = renderHook(() => useMeshtasticRuntime());

    await act(async () => {
      await result.current.setNodeFavorited(NODE_ID, true);
    });

    expect(window.electronAPI.db.setNodeFavorited).toHaveBeenCalledWith(NODE_ID, true);
    expect(useNodeStore.getState().nodes[OFFLINE_MESHTASTIC_IDENTITY_ID][NODE_ID].favorited).toBe(
      true,
    );
  });
});
