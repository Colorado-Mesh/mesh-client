/**
 * MeshCore contact management: clear-all (DB + memory), apply auto-add (requires connection),
 * refresh auto-add config (no-op when disconnected).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { meshcoreSyntheticPlaceholderPubKeyHex } from '../lib/meshcoreUtils';
import {
  ensureOfflineProtocolIdentities,
  OFFLINE_MESHCORE_IDENTITY_ID,
} from '../lib/offlineProtocolIdentities';
import { useMeshcoreRuntime } from '../runtime/useMeshcoreRuntime';
import { upsertNode, useNodeStore } from '../stores/nodeStore';

const STUB_SENDER_ID = 0x12345678;

const APPLY_PARAMS = {
  autoAddAll: true,
  overwriteOldest: false,
  chat: false,
  repeater: false,
  roomServer: false,
  sensor: false,
  maxHopsWire: 0,
} as const;

describe('useMeshcoreRuntime contact management (no radio connection)', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.clearMeshcoreContacts).mockResolvedValue(undefined);
  });

  it('clearAllMeshcoreContacts clears SQLite and empties nodes when self node id is 0', async () => {
    const { result } = renderHook(() => useMeshcoreRuntime());

    await waitFor(() => {
      expect(window.electronAPI.db.getMeshcoreMessages).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.clearAllMeshcoreContacts();
    });

    expect(window.electronAPI.db.clearMeshcoreContacts).toHaveBeenCalledTimes(1);
    expect(result.current.meshcoreContactsForTelemetry).toEqual([]);
    expect(result.current.nodes.size).toBe(0);
  });

  it('applyMeshcoreContactAutoAdd throws when not connected', async () => {
    const { result } = renderHook(() => useMeshcoreRuntime());

    await waitFor(() => {
      expect(window.electronAPI.db.getMeshcoreMessages).toHaveBeenCalled();
    });

    await expect(result.current.applyMeshcoreContactAutoAdd(APPLY_PARAMS)).rejects.toThrow(
      'Not connected',
    );
  });

  it('refreshMeshcoreAutoaddFromDevice resolves without error when not connected', async () => {
    const { result } = renderHook(() => useMeshcoreRuntime());

    await waitFor(() => {
      expect(window.electronAPI.db.getMeshcoreMessages).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.refreshMeshcoreAutoaddFromDevice();
    });

    expect(result.current.meshcoreAutoadd).toBeNull();
  });

  it('setNodeFavorited passes synthetic pubkey hex when contact has no key in memory (DB insert path)', async () => {
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([
      {
        id: 1,
        sender_id: STUB_SENDER_ID,
        sender_name: 'Alice',
        payload: 'hi',
        channel_idx: 0,
        timestamp: 1_700_000_000_000,
        status: 'acked',
        packet_id: null,
        emoji: null,
        reply_id: null,
        to_node: null,
        received_via: 'mqtt',
      },
    ]);

    const { result } = renderHook(() => useMeshcoreRuntime());

    await waitFor(() => {
      expect(result.current.nodes.has(STUB_SENDER_ID)).toBe(true);
    });

    await act(async () => {
      await result.current.setNodeFavorited(STUB_SENDER_ID, true);
    });

    expect(window.electronAPI.db.updateMeshcoreContactFavorited).toHaveBeenCalledWith(
      STUB_SENDER_ID,
      true,
      meshcoreSyntheticPlaceholderPubKeyHex(STUB_SENDER_ID),
    );
  });

  it('setNodeFavorited updates nodeStore when contact exists only in the UI store bucket', async () => {
    ensureOfflineProtocolIdentities();
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    upsertNode(OFFLINE_MESHCORE_IDENTITY_ID, {
      nodeId: STUB_SENDER_ID,
      longName: 'Alice',
    });

    const { result } = renderHook(() => useMeshcoreRuntime());

    await act(async () => {
      await result.current.setNodeFavorited(STUB_SENDER_ID, true);
    });

    expect(
      useNodeStore.getState().nodes[OFFLINE_MESHCORE_IDENTITY_ID][STUB_SENDER_ID].favorited,
    ).toBe(true);
  });
});
