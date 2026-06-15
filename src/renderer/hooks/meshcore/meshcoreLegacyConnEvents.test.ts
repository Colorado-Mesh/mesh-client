import { describe, expect, it } from 'vitest';

import {
  applyMeshcoreAdvertEvent128,
  applyMeshcorePathUpdated129,
} from '@/renderer/lib/meshcore/meshcoreAdvertEventApply';
import { pubkeyToNodeId } from '@/renderer/lib/meshcoreUtils';
import type { MeshNode } from '@/renderer/lib/types';

function makePubKey(seed: number): Uint8Array {
  const key = new Uint8Array(32);
  key[0] = seed;
  key[31] = 0xff;
  return key;
}

function minimalNode(
  overrides: Partial<MeshNode> & Pick<MeshNode, 'node_id' | 'long_name'>,
): MeshNode {
  return {
    short_name: '',
    hw_model: 'Client',
    snr: 0,
    rssi: 0,
    last_heard: 1_700_000_000,
    battery: 0,
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

describe('applyMeshcoreAdvertEvent128', () => {
  it('inserts a new contact and returns insert persist metadata', () => {
    const publicKey = makePubKey(7);
    const nodeId = pubkeyToNodeId(publicKey);
    const nowSec = 1_700_000_000;

    const { next, persist } = applyMeshcoreAdvertEvent128(
      new Map(),
      { publicKey, advName: 'Alpha', type: 1, lastAdvert: nowSec },
      { nodeId, nowSec, myNodeNum: null },
    );

    expect(persist.kind).toBe('insert');
    expect(persist.updatePubKeyMaps).toBe(true);
    expect(persist.insertAdvName).toBe('Alpha');
    expect(next.get(nodeId)?.long_name).toBe('Alpha');
  });

  it('updates existing contact last_heard without insert persist', () => {
    const publicKey = makePubKey(9);
    const nodeId = pubkeyToNodeId(publicKey);
    const nowSec = 1_700_000_100;
    const prev = new Map<number, MeshNode>([
      [nodeId, minimalNode({ node_id: nodeId, long_name: 'Existing', last_heard: 1_700_000_000 })],
    ]);

    const { next, persist } = applyMeshcoreAdvertEvent128(
      prev,
      { publicKey, lastAdvert: nowSec },
      { nodeId, nowSec, myNodeNum: null },
    );

    expect(persist.kind).toBe('update');
    expect(persist.persistLastAdvert).toBe(nowSec);
    expect(next.get(nodeId)?.last_heard).toBe(nowSec);
  });
});

describe('applyMeshcorePathUpdated129', () => {
  it('inserts minimal node when path-updated arrives before advert', () => {
    const publicKey = makePubKey(3);
    const nodeId = pubkeyToNodeId(publicKey);
    const nowSec = 1_700_000_200;

    const { next, persist } = applyMeshcorePathUpdated129(new Map(), publicKey, {
      nodeId,
      nowSec,
    });

    expect(persist.kind).toBe('insert');
    expect(persist.updatePubKeyMaps).toBe(true);
    expect(next.has(nodeId)).toBe(true);
  });

  it('bumps last_heard for existing contact', () => {
    const publicKey = makePubKey(5);
    const nodeId = pubkeyToNodeId(publicKey);
    const nowSec = 1_700_000_300;
    const prev = new Map<number, MeshNode>([
      [nodeId, minimalNode({ node_id: nodeId, long_name: 'Node', last_heard: 1_700_000_000 })],
    ]);

    const { next, persist } = applyMeshcorePathUpdated129(prev, publicKey, { nodeId, nowSec });

    expect(persist.kind).toBe('update');
    expect(next.get(nodeId)?.last_heard).toBe(nowSec);
  });
});
