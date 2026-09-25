import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReticulumRmapDiscoveredWireRow } from '@/shared/reticulum-types';

import {
  collectTakNodeUpdates,
  meshNodeToTakUpdate,
  rmapRowToTakUpdate,
  type TakFeedSources,
  takNodeUpdateKey,
  takNodeUpdateSignature,
} from './takNodeFeed';
import type { MeshNode } from './types';

const NOW_MS = Date.UTC(2026, 8, 1, 12, 0, 0);
const NOW_SEC = NOW_MS / 1000;
const HOUR_SEC = 3600;

function node(overrides: Partial<MeshNode> = {}): MeshNode {
  return {
    node_id: 100,
    long_name: 'Ridge',
    short_name: 'RDG',
    hw_model: '',
    snr: 0,
    battery: 90,
    last_heard: NOW_SEC - 60,
    latitude: 39.7,
    longitude: -105.1,
    ...overrides,
  };
}

function rmapRow(overrides: Partial<ReticulumRmapDiscoveredWireRow> = {}) {
  return {
    discovery_hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9',
    transport_id: '00112233445566778899aabbccddeeff',
    discovery_name: 'Mesa RNode',
    interface_type: 'RNodeInterface',
    latitude: 39.5,
    longitude: -105.5,
    height: 2100,
    transport_enabled: true,
    hops: 1,
    stamp_value: 0,
    discovered: NOW_SEC - HOUR_SEC,
    last_heard: NOW_SEC - HOUR_SEC,
    heard_count: 3,
    status: 'available',
    has_coordinates: true,
    ...overrides,
  } satisfies ReticulumRmapDiscoveredWireRow;
}

function sources(overrides: Partial<TakFeedSources> = {}): TakFeedSources {
  return {
    nodesByProtocol: { meshtastic: new Map(), meshcore: new Map(), reticulum: new Map() },
    rmapRows: [],
    reticulumSelf: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('meshNodeToTakUpdate', () => {
  it('maps a positioned, recently heard node', () => {
    expect(meshNodeToTakUpdate(node({ altitude: 1650 }), 'meshcore')).toEqual({
      node_id: 100,
      protocol: 'meshcore',
      latitude: 39.7,
      longitude: -105.1,
      altitude: 1650,
      short_name: 'RDG',
      long_name: 'Ridge',
      battery: 90,
      last_heard: NOW_SEC - 60,
    });
  });

  it.each([
    ['no latitude', { latitude: null }],
    ['no longitude', { longitude: null }],
    ['the (0, 0) placeholder', { latitude: 0, longitude: 0 }],
    ['an out-of-range latitude', { latitude: 95 }],
    ['a zero node id', { node_id: 0 }],
    ['never heard', { last_heard: 0 }],
  ])('skips a node with %s', (_label, overrides) => {
    expect(meshNodeToTakUpdate(node(overrides), 'meshtastic')).toBeNull();
  });

  it("uses each protocol's own online window", () => {
    // Heard 10 h ago: past Meshtastic's 2 h window, inside MeshCore's 48 h window.
    const heard10hAgo = node({ last_heard: NOW_SEC - 10 * HOUR_SEC });
    expect(meshNodeToTakUpdate(heard10hAgo, 'meshtastic')).toBeNull();
    expect(meshNodeToTakUpdate(heard10hAgo, 'meshcore')).not.toBeNull();
  });

  it('accepts last_heard in epoch milliseconds', () => {
    expect(meshNodeToTakUpdate(node({ last_heard: NOW_MS - 60_000 }), 'meshtastic')).not.toBeNull();
  });
});

describe('rmapRowToTakUpdate', () => {
  it('maps a discovered interface with coordinates to a Reticulum node', () => {
    const update = rmapRowToTakUpdate(rmapRow());
    expect(update).toMatchObject({
      protocol: 'reticulum',
      latitude: 39.5,
      longitude: -105.5,
      altitude: 2100,
      long_name: 'Mesa RNode',
    });
    // First 12 hex chars folded to uint32, matching reticulumHashToNodeId.
    expect(update?.node_id).toBe(0xa1b2c3d4e5f6 >>> 0);
  });

  it('keeps the node id stable across updates of the same row', () => {
    const first = rmapRowToTakUpdate(rmapRow());
    const second = rmapRowToTakUpdate(rmapRow({ last_heard: NOW_SEC - 10, latitude: 39.51 }));
    expect(second?.node_id).toBe(first?.node_id);
  });

  it('falls back to the interface type when the row has no name', () => {
    expect(rmapRowToTakUpdate(rmapRow({ discovery_name: '' }))?.long_name).toBe('RNodeInterface');
  });

  it.each([
    ['has_coordinates is false', { has_coordinates: false }],
    ['the coordinates are (0, 0)', { latitude: 0, longitude: 0 }],
    ['the hash has no hex digits', { discovery_hash: 'zzzz' }],
    ['it was last heard over 7 days ago', { last_heard: NOW_SEC - 8 * 24 * HOUR_SEC }],
  ])('skips a row when %s', (_label, overrides) => {
    expect(rmapRowToTakUpdate(rmapRow(overrides))).toBeNull();
  });
});

describe('collectTakNodeUpdates', () => {
  it('collects nodes from every protocol, RMAP rows, and our Reticulum position', () => {
    const updates = collectTakNodeUpdates(
      sources({
        nodesByProtocol: {
          meshtastic: new Map([[1, node({ node_id: 1 })]]),
          meshcore: new Map([
            [1, node({ node_id: 1 })],
            [2, node({ node_id: 2, latitude: null })],
          ]),
          reticulum: new Map(),
        },
        rmapRows: [rmapRow()],
        reticulumSelf: { nodeId: 77, name: 'Base', latitude: 39.9, longitude: -105.2 },
      }),
    );
    expect(updates.map(takNodeUpdateKey)).toEqual([
      'meshtastic:1',
      'meshcore:1',
      `reticulum:${0xa1b2c3d4e5f6 >>> 0}`,
      'reticulum:77',
    ]);
    expect(updates.at(-1)).toMatchObject({ long_name: 'Base', last_heard: NOW_SEC });
  });

  it('leaves out our Reticulum position when it is the (0, 0) placeholder', () => {
    const updates = collectTakNodeUpdates(
      sources({ reticulumSelf: { nodeId: 77, name: 'Base', latitude: 0, longitude: 0 } }),
    );
    expect(updates).toEqual([]);
  });
});

describe('takNodeUpdateSignature', () => {
  it('ignores last_heard so a re-heard node with no changes is not re-sent', () => {
    const a = meshNodeToTakUpdate(node({ last_heard: NOW_SEC - 60 }), 'meshtastic')!;
    const b = meshNodeToTakUpdate(node({ last_heard: NOW_SEC - 5 }), 'meshtastic')!;
    expect(takNodeUpdateSignature(a)).toBe(takNodeUpdateSignature(b));
  });

  it('changes when the position moves', () => {
    const a = meshNodeToTakUpdate(node(), 'meshtastic')!;
    const b = meshNodeToTakUpdate(node({ latitude: 39.71 }), 'meshtastic')!;
    expect(takNodeUpdateSignature(a)).not.toBe(takNodeUpdateSignature(b));
  });
});
