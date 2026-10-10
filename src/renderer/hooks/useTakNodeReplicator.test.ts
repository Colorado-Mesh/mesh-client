import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TAK_NODE_REFRESH_MS, TAK_NODE_SCAN_INTERVAL_MS } from '@/renderer/lib/takNodeFeed';
import type { MeshNode } from '@/renderer/lib/types';
import { isTakSinkActive } from '@/renderer/stores/takSinkStore';
import { clearTakTrackerFixes, recordTakTrackerFix } from '@/renderer/stores/takTrackerStore';

import { useTakNodeReplicator } from './useTakNodeReplicator';

const NOW_MS = Date.UTC(2026, 8, 1, 12, 0, 0);
const NOW_SEC = NOW_MS / 1000;

function node(id: number, overrides: Partial<MeshNode> = {}): MeshNode {
  return {
    node_id: id,
    long_name: `Node ${id}`,
    short_name: '',
    hw_model: '',
    snr: 0,
    battery: 50,
    last_heard: NOW_SEC - 30,
    latitude: 39.7,
    longitude: -105,
    ...overrides,
  };
}

function nodesByProtocol(
  meshtastic: MeshNode[] = [],
  meshcore: MeshNode[] = [],
): Record<'meshtastic' | 'meshcore', Map<number, MeshNode>> {
  return {
    meshtastic: new Map(meshtastic.map((n) => [n.node_id, n])),
    meshcore: new Map(meshcore.map((n) => [n.node_id, n])),
  };
}

interface Props {
  active: boolean;
  nodes: ReturnType<typeof nodesByProtocol>;
}

function renderReplicator(initial: Props) {
  return renderHook(
    ({ active, nodes }: Props) => {
      useTakNodeReplicator({
        active,
        nodesByProtocol: nodes,
      });
    },
    { initialProps: initial },
  );
}

const pushNodeUpdates = () => vi.mocked(window.electronAPI.tak.pushNodeUpdates);

function pushedKeys(): string[][] {
  return pushNodeUpdates().mock.calls.map((c) => c[0].map((u) => `${u.protocol}:${u.node_id}`));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  pushNodeUpdates().mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useTakNodeReplicator', () => {
  it('sends nothing while no TAK sink is active', () => {
    renderReplicator({ active: false, nodes: nodesByProtocol([node(1)]) });
    act(() => {
      vi.advanceTimersByTime(TAK_NODE_REFRESH_MS * 2);
    });
    expect(pushNodeUpdates()).not.toHaveBeenCalled();
  });

  it('sends every eligible node from all protocols when a sink becomes active', () => {
    const nodes = nodesByProtocol([node(1), node(2, { latitude: null })], [node(1)]);
    const { rerender } = renderReplicator({ active: false, nodes });
    rerender({ active: true, nodes });
    expect(pushedKeys()).toEqual([['meshtastic:1', 'meshcore:1']]);
  });

  it('sends only changed nodes on the next scan', () => {
    const { rerender } = renderReplicator({
      active: true,
      nodes: nodesByProtocol([node(1), node(2)]),
    });
    pushNodeUpdates().mockClear();

    // last_heard moves on node 1 (no visible change); node 2 moves.
    rerender({
      active: true,
      nodes: nodesByProtocol([node(1, { last_heard: NOW_SEC }), node(2, { latitude: 39.8 })]),
    });
    expect(pushNodeUpdates()).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(TAK_NODE_SCAN_INTERVAL_MS);
    });
    expect(pushedKeys()).toEqual([['meshtastic:2']]);
  });

  it('coalesces a burst of node changes into one scan', () => {
    const { rerender } = renderReplicator({ active: true, nodes: nodesByProtocol([node(1)]) });
    pushNodeUpdates().mockClear();
    for (let i = 1; i <= 5; i++) {
      rerender({ active: true, nodes: nodesByProtocol([node(1, { latitude: 39 + i / 100 })]) });
    }
    act(() => {
      vi.advanceTimersByTime(TAK_NODE_SCAN_INTERVAL_MS);
    });
    expect(pushNodeUpdates()).toHaveBeenCalledTimes(1);
    expect(pushNodeUpdates().mock.calls[0]?.[0][0]?.latitude).toBe(39.05);
  });

  it('re-sends unchanged nodes on the refresh interval so ATAK markers do not go stale', () => {
    renderReplicator({ active: true, nodes: nodesByProtocol([], [node(9)]) });
    pushNodeUpdates().mockClear();
    act(() => {
      vi.advanceTimersByTime(TAK_NODE_REFRESH_MS);
    });
    expect(pushedKeys()).toEqual([['meshcore:9']]);
  });

  it('stops sending when the sink stops', () => {
    const nodes = nodesByProtocol([node(1)]);
    const { rerender } = renderReplicator({ active: true, nodes });
    rerender({ active: false, nodes });
    pushNodeUpdates().mockClear();
    act(() => {
      vi.advanceTimersByTime(TAK_NODE_REFRESH_MS * 2);
    });
    expect(pushNodeUpdates()).not.toHaveBeenCalled();
  });

  it('splits large sends into batches the IPC handler accepts', () => {
    const many = Array.from({ length: 1200 }, (_, i) => node(i + 1));
    renderReplicator({ active: true, nodes: nodesByProtocol(many) });
    expect(pushNodeUpdates().mock.calls.map((c) => c[0].length)).toEqual([500, 500, 200]);
  });
});

describe('useTakNodeReplicator tracker fixes and sink flag', () => {
  afterEach(() => {
    clearTakTrackerFixes();
  });

  it('mirrors the active flag into the TAK sink store', () => {
    const { rerender, unmount } = renderReplicator({ active: true, nodes: nodesByProtocol() });
    expect(isTakSinkActive()).toBe(true);
    rerender({ active: false, nodes: nodesByProtocol() });
    expect(isTakSinkActive()).toBe(false);
    rerender({ active: true, nodes: nodesByProtocol() });
    unmount();
    expect(isTakSinkActive()).toBe(false);
  });

  it('sends a newly recorded tracker fix under its stable uid', () => {
    renderReplicator({ active: true, nodes: nodesByProtocol() });
    pushNodeUpdates().mockClear();
    act(() => {
      recordTakTrackerFix(
        { callsign: 'Rex', id8: 'a1b2c3d4', role: 'k9', lat: 39.7, lon: -105.1, speed: 2 },
        NOW_MS,
      );
    });
    act(() => {
      vi.advanceTimersByTime(TAK_NODE_SCAN_INTERVAL_MS);
    });
    const sent = pushNodeUpdates().mock.calls.flatMap((c) => c[0]);
    expect(sent).toEqual([
      expect.objectContaining({
        uid: 'meshtracker-a1b2c3d4',
        node_id: 0xa1b2c3d4,
        tracker_role: 'k9',
        long_name: 'Rex',
        speed: 2,
      }),
    ]);
  });
});
