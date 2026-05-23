import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import type { MeshNode } from '../lib/types';
import { useWatchedNodesStore } from '../stores/watchedNodesStore';
import { useNodeStatusNotifier } from './useNodeStatusNotifier';

function makeNode(overrides: Partial<MeshNode> = {}): MeshNode {
  return {
    node_id: 1,
    long_name: 'TestNode',
    short_name: 'TN',
    hw_model: '',
    snr: 0,
    battery: 0,
    last_heard: Date.now(),
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

const ONLINE_LAST_HEARD = Date.now();
const OFFLINE_LAST_HEARD = 0;

const meshtasticCaps = {
  protocol: 'meshtastic',
  nodeStaleThresholdMs: 2 * 3_600_000,
  nodeOfflineThresholdMs: 7 * 24 * 3_600_000,
} as unknown as ProtocolCapabilities;

const meshcoreCaps = {
  ...meshtasticCaps,
  protocol: 'meshcore',
} as unknown as ProtocolCapabilities;

describe('useNodeStatusNotifier', () => {
  let notificationSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    notificationSpy = vi.fn();
    vi.stubGlobal('Notification', Object.assign(notificationSpy, { permission: 'granted' }));
    useWatchedNodesStore.setState({ watchedNodeIds: new Set() });
  });

  it('does not fire on initial render (no prev state)', () => {
    useWatchedNodesStore.setState({ watchedNodeIds: new Set([1]) });
    const nodes = new Map([[1, makeNode({ node_id: 1, last_heard: ONLINE_LAST_HEARD })]]);
    renderHook(() => {
      useNodeStatusNotifier(nodes, meshtasticCaps);
    });
    expect(notificationSpy).not.toHaveBeenCalled();
  });

  it('fires "online" notification when node transitions offline→online', () => {
    useWatchedNodesStore.setState({ watchedNodeIds: new Set([1]) });
    const offlineNodes = new Map([[1, makeNode({ node_id: 1, last_heard: OFFLINE_LAST_HEARD })]]);
    const onlineNodes = new Map([[1, makeNode({ node_id: 1, last_heard: ONLINE_LAST_HEARD })]]);

    const { rerender } = renderHook(
      ({ nodes }: { nodes: Map<number, MeshNode> }) => {
        useNodeStatusNotifier(nodes, meshtasticCaps);
      },
      { initialProps: { nodes: offlineNodes } },
    );
    // First render: prev is empty → skip, prev set to offline
    rerender({ nodes: onlineNodes });
    // Second render: prev=offline, now=online → fire
    expect(notificationSpy).toHaveBeenCalledOnce();
    expect(notificationSpy).toHaveBeenCalledWith(
      'TestNode is online',
      expect.objectContaining({ body: 'Meshtastic node came online' }),
    );
  });

  it('fires "offline" notification when node transitions online→offline', () => {
    useWatchedNodesStore.setState({ watchedNodeIds: new Set([1]) });
    const onlineNodes = new Map([[1, makeNode({ node_id: 1, last_heard: ONLINE_LAST_HEARD })]]);
    const offlineNodes = new Map([[1, makeNode({ node_id: 1, last_heard: OFFLINE_LAST_HEARD })]]);

    const { rerender } = renderHook(
      ({ nodes }: { nodes: Map<number, MeshNode> }) => {
        useNodeStatusNotifier(nodes, meshtasticCaps);
      },
      { initialProps: { nodes: onlineNodes } },
    );
    rerender({ nodes: offlineNodes });
    expect(notificationSpy).toHaveBeenCalledOnce();
    const [title] = notificationSpy.mock.calls[0] as [string];
    expect(title).toBe('TestNode went offline');
  });

  it('uses "MeshCore" label for meshcore capabilities', () => {
    useWatchedNodesStore.setState({ watchedNodeIds: new Set([1]) });
    const offlineNodes = new Map([[1, makeNode({ node_id: 1, last_heard: OFFLINE_LAST_HEARD })]]);
    const onlineNodes = new Map([[1, makeNode({ node_id: 1, last_heard: ONLINE_LAST_HEARD })]]);

    const { rerender } = renderHook(
      ({ nodes }: { nodes: Map<number, MeshNode> }) => {
        useNodeStatusNotifier(nodes, meshcoreCaps);
      },
      { initialProps: { nodes: offlineNodes } },
    );
    rerender({ nodes: onlineNodes });
    expect(notificationSpy).toHaveBeenCalledWith(
      'TestNode is online',
      expect.objectContaining({ body: 'MeshCore node came online' }),
    );
  });

  it('does not fire when watched set is empty', () => {
    useWatchedNodesStore.setState({ watchedNodeIds: new Set() });
    const onlineNodes = new Map([[1, makeNode({ node_id: 1, last_heard: ONLINE_LAST_HEARD })]]);
    const offlineNodes = new Map([[1, makeNode({ node_id: 1, last_heard: OFFLINE_LAST_HEARD })]]);

    const { rerender } = renderHook(
      ({ nodes }: { nodes: Map<number, MeshNode> }) => {
        useNodeStatusNotifier(nodes, meshtasticCaps);
      },
      { initialProps: { nodes: onlineNodes } },
    );
    rerender({ nodes: offlineNodes });
    expect(notificationSpy).not.toHaveBeenCalled();
  });

  it('does not fire for unwatched nodes even when status changes', () => {
    useWatchedNodesStore.setState({ watchedNodeIds: new Set([99]) }); // node 1 not watched
    const offlineNodes = new Map([[1, makeNode({ node_id: 1, last_heard: OFFLINE_LAST_HEARD })]]);
    const onlineNodes = new Map([[1, makeNode({ node_id: 1, last_heard: ONLINE_LAST_HEARD })]]);

    const { rerender } = renderHook(
      ({ nodes }: { nodes: Map<number, MeshNode> }) => {
        useNodeStatusNotifier(nodes, meshtasticCaps);
      },
      { initialProps: { nodes: offlineNodes } },
    );
    rerender({ nodes: onlineNodes });
    expect(notificationSpy).not.toHaveBeenCalled();
  });

  it('falls back to short_name then hex id in notification title', () => {
    useWatchedNodesStore.setState({ watchedNodeIds: new Set([1]) });
    const offlineNodes = new Map([
      [
        1,
        makeNode({ node_id: 1, long_name: '', short_name: 'SN', last_heard: OFFLINE_LAST_HEARD }),
      ],
    ]);
    const onlineNodes = new Map([
      [1, makeNode({ node_id: 1, long_name: '', short_name: 'SN', last_heard: ONLINE_LAST_HEARD })],
    ]);

    const { rerender } = renderHook(
      ({ nodes }: { nodes: Map<number, MeshNode> }) => {
        useNodeStatusNotifier(nodes, meshtasticCaps);
      },
      { initialProps: { nodes: offlineNodes } },
    );
    rerender({ nodes: onlineNodes });
    const [title] = notificationSpy.mock.calls[0] as [string];
    expect(title).toBe('SN is online');
  });

  it('uses padded Meshtastic node id when names are empty', () => {
    useWatchedNodesStore.setState({ watchedNodeIds: new Set([0x0bcd5737]) });
    const nodeId = 0x0bcd5737;
    const offlineNodes = new Map([
      [
        nodeId,
        makeNode({
          node_id: nodeId,
          long_name: '',
          short_name: '',
          last_heard: OFFLINE_LAST_HEARD,
        }),
      ],
    ]);
    const onlineNodes = new Map([
      [
        nodeId,
        makeNode({ node_id: nodeId, long_name: '', short_name: '', last_heard: ONLINE_LAST_HEARD }),
      ],
    ]);

    const { rerender } = renderHook(
      ({ nodes }: { nodes: Map<number, MeshNode> }) => {
        useNodeStatusNotifier(nodes, meshtasticCaps);
      },
      { initialProps: { nodes: offlineNodes } },
    );
    rerender({ nodes: onlineNodes });
    const [title] = notificationSpy.mock.calls[0] as [string];
    expect(title).toBe('!0bcd5737 is online');
  });

  it('uses MeshCore hex fallback when names are empty', () => {
    useWatchedNodesStore.setState({ watchedNodeIds: new Set([0xf6]) });
    const nodeId = 0xf6;
    const offlineNodes = new Map([
      [
        nodeId,
        makeNode({
          node_id: nodeId,
          long_name: '',
          short_name: '',
          last_heard: OFFLINE_LAST_HEARD,
        }),
      ],
    ]);
    const onlineNodes = new Map([
      [
        nodeId,
        makeNode({ node_id: nodeId, long_name: '', short_name: '', last_heard: ONLINE_LAST_HEARD }),
      ],
    ]);

    const { rerender } = renderHook(
      ({ nodes }: { nodes: Map<number, MeshNode> }) => {
        useNodeStatusNotifier(nodes, meshcoreCaps);
      },
      { initialProps: { nodes: offlineNodes } },
    );
    rerender({ nodes: onlineNodes });
    const [title] = notificationSpy.mock.calls[0] as [string];
    expect(title).toBe('Node-F6 is online');
  });
});
