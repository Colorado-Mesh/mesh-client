/**
 * MeshCore contact management: clear-all (DB + memory), apply auto-add (requires connection),
 * refresh auto-add config (no-op when disconnected).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isMeshcoreLocallyDeletedContact,
  resetMeshcoreLocallyDeletedContactsForTests,
} from '../lib/meshcoreLocallyDeletedContacts';
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
    resetMeshcoreLocallyDeletedContactsForTests();
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.clearMeshcoreContacts).mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.db.deleteMeshcoreContact).mockResolvedValue(undefined);
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

  it('deleteNode removes the contact from nodeStore and marks it locally deleted', async () => {
    const chatNodeId = 0x23456789;
    ensureOfflineProtocolIdentities();
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    upsertNode(OFFLINE_MESHCORE_IDENTITY_ID, {
      nodeId: chatNodeId,
      longName: 'Bob',
      hwModel: 'Chat',
    });

    const { result } = renderHook(() => useMeshcoreRuntime());

    await act(async () => {
      await result.current.deleteNode(chatNodeId);
    });

    expect(window.electronAPI.db.deleteMeshcoreContact).toHaveBeenCalledWith(chatNodeId);
    expect(
      useNodeStore.getState().nodes[OFFLINE_MESHCORE_IDENTITY_ID]?.[chatNodeId],
    ).toBeUndefined();
    expect(isMeshcoreLocallyDeletedContact(chatNodeId)).toBe(true);
    expect(result.current.nodes.has(chatNodeId)).toBe(false);
  });

  it('deleted contact stays deleted when stub merge / chat-sender upsert tries to resurrect', async () => {
    const chatNodeId = 0x3456789a;
    ensureOfflineProtocolIdentities();
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    upsertNode(OFFLINE_MESHCORE_IDENTITY_ID, {
      nodeId: chatNodeId,
      longName: 'Carol',
      hwModel: 'Chat',
    });

    const { result } = renderHook(() => useMeshcoreRuntime());

    await act(async () => {
      await result.current.deleteNode(chatNodeId);
    });
    expect(isMeshcoreLocallyDeletedContact(chatNodeId)).toBe(true);

    const { mergeStubNodesFromMeshcoreMessages } = await import('./meshcore/meshcoreHookPreamble');
    const { ensureMeshcoreChatSenderInNodeStore } =
      await import('../lib/meshcore/meshcoreChatSenderNode');
    const { mergeMeshcoreChatStubNodes, minimalMeshcoreChatNode } =
      await import('../lib/meshcoreUtils');

    const mergedStubs = mergeStubNodesFromMeshcoreMessages(new Map(), [
      {
        id: 1,
        sender_id: chatNodeId,
        sender_name: 'Carol',
        payload: 'hi',
        channel: 0,
        timestamp: Date.now(),
        status: 'acked',
        receivedVia: 'mqtt',
      },
    ]);
    expect(mergedStubs.has(chatNodeId)).toBe(false);

    ensureMeshcoreChatSenderInNodeStore(OFFLINE_MESHCORE_IDENTITY_ID, chatNodeId, {
      lastHeardAtMs: Date.now(),
      displayName: 'Carol',
      source: 'mqtt',
    });
    expect(
      useNodeStore.getState().nodes[OFFLINE_MESHCORE_IDENTITY_ID]?.[chatNodeId],
    ).toBeUndefined();

    const device = new Map([
      [
        chatNodeId,
        minimalMeshcoreChatNode(chatNodeId, 'Carol', Math.floor(Date.now() / 1000), 'rf'),
      ],
    ]);
    const merged = mergeMeshcoreChatStubNodes(new Map(), device);
    expect(merged.has(chatNodeId)).toBe(false);
    expect(result.current.nodes.has(chatNodeId)).toBe(false);
  });
});
