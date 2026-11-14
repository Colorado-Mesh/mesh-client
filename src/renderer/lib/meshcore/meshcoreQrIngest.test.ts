import { beforeEach, describe, expect, it, vi } from 'vitest';

import { syncNodesMapToIdentityStore } from '@/renderer/lib/hydrateIdentityStoresFromDb';
import { getIdentityNodeMap } from '@/renderer/lib/identityStoreReads';
import {
  applyMeshcoreQrImportToNodesMap,
  classifyMeshcoreQr,
  importMeshcoreQr,
  mergeMeshcoreQrContactNode,
  resetMeshcoreQrImportOwnersForTests,
} from '@/renderer/lib/meshcore/meshcoreQrIngest';
import type { MeshNode } from '@/renderer/lib/types';
import { removeNode } from '@/renderer/stores/nodeStore';
import {
  buildMeshcoreChannelAddUri,
  buildMeshcoreContactAddUri,
} from '@/shared/meshClientDeepLink';

vi.mock('@/renderer/lib/hydrateIdentityStoresFromDb', () => ({
  syncNodesMapToIdentityStore: vi.fn(),
}));

vi.mock('@/renderer/lib/identityStoreReads', () => ({
  getIdentityNodeMap: vi.fn(() => new Map()),
}));

vi.mock('@/renderer/stores/nodeStore', () => ({
  removeNode: vi.fn(),
}));

/** Non-repeating hex so pubkeyToNodeId is non-zero (periodic/all-identical bytes XOR to 0). */
const PUBKEY = '00112233445566778899aabbccddeeff0102030405060708090a0b0c0d0e0f10';
const SECRET = 'b'.repeat(32);

function baseNode(overrides: Partial<MeshNode> = {}): MeshNode {
  return {
    node_id: 1,
    long_name: 'Prev',
    short_name: 'P',
    hw_model: 'Companion',
    snr: 7.5,
    battery: 88,
    last_heard: 100,
    latitude: 40.1,
    longitude: -105.2,
    on_radio: true,
    favorited: true,
    ...overrides,
  };
}

describe('classifyMeshcoreQr', () => {
  it('returns unsupported for empty / wrong scheme', () => {
    expect(classifyMeshcoreQr('')).toEqual({ kind: 'unsupported' });
    expect(classifyMeshcoreQr('https://example.com')).toEqual({ kind: 'unsupported' });
  });

  it('classifies MeshCore contact add', () => {
    const uri = buildMeshcoreContactAddUri({
      name: 'Alice',
      publicKeyHex: PUBKEY,
      type: 1,
    });
    expect(classifyMeshcoreQr(uri)).toEqual({
      kind: 'meshcoreContactAdd',
      name: 'Alice',
      publicKeyHex: PUBKEY,
      type: 1,
    });
  });

  it('classifies MeshCore channel add and omits absent regionScope', () => {
    const uri = buildMeshcoreChannelAddUri({ name: 'Metro', secretHex: SECRET });
    expect(classifyMeshcoreQr(uri)).toEqual({
      kind: 'meshcoreChannelAdd',
      name: 'Metro',
      secretHex: SECRET,
    });
    expect(classifyMeshcoreQr(uri)).not.toHaveProperty('regionScope');
  });

  it('rejects bad contact key', () => {
    expect(classifyMeshcoreQr('meshcore://contact/add?name=A&public_key=zz&type=1')).toEqual({
      kind: 'unsupported',
    });
  });

  it('classifies Meshtastic channel URL', () => {
    const url = 'https://meshtastic.org/e/#abc';
    expect(classifyMeshcoreQr(url)).toEqual({ kind: 'meshtasticChannel', url });
  });
});

describe('mergeMeshcoreQrContactNode', () => {
  it('preserves coordinates, SNR, and battery when QR has placeholders', () => {
    const previous = baseNode();
    const imported = baseNode({
      long_name: 'FromQr',
      snr: 0,
      battery: 0,
      latitude: null,
      longitude: null,
      on_radio: false,
      favorited: false,
    });
    const merged = mergeMeshcoreQrContactNode(previous, imported);
    expect(merged.long_name).toBe('FromQr');
    expect(merged.snr).toBe(7.5);
    expect(merged.battery).toBe(88);
    expect(merged.latitude).toBe(40.1);
    expect(merged.longitude).toBe(-105.2);
    expect(merged.on_radio).toBe(true);
    expect(merged.favorited).toBe(true);
  });

  it('uses imported defaults when creating a new contact', () => {
    const imported = baseNode({ long_name: 'New', snr: 0, battery: 0, latitude: null });
    const merged = mergeMeshcoreQrContactNode(undefined, imported);
    expect(merged.long_name).toBe('New');
    expect(merged.snr).toBe(0);
    expect(merged.on_radio).toBe(false);
  });

  it('does not invent on_radio when the previous record omitted it', () => {
    const previous = baseNode({ on_radio: undefined });
    delete previous.on_radio;
    const merged = mergeMeshcoreQrContactNode(
      previous,
      baseNode({ long_name: 'X', on_radio: false }),
    );
    expect(merged).not.toHaveProperty('on_radio');
  });
});

describe('applyMeshcoreQrImportToNodesMap', () => {
  it('keeps RF fields from liveNodes when React prev is stale', () => {
    const nodeId = 42;
    const qrNode = baseNode({
      node_id: nodeId,
      long_name: 'FromQr',
      snr: 0,
      battery: 0,
      favorited: false,
    });
    const prev = new Map<number, MeshNode>([
      [nodeId, baseNode({ node_id: nodeId, long_name: 'Stale', snr: 1, battery: 10 })],
    ]);
    const liveNodes = new Map<number, MeshNode>([
      [
        nodeId,
        baseNode({
          node_id: nodeId,
          long_name: 'Stale',
          snr: 12.5,
          battery: 91,
          favorited: true,
          last_heard: 999,
        }),
      ],
    ]);
    const next = applyMeshcoreQrImportToNodesMap(prev, nodeId, qrNode, liveNodes);
    expect(next.get(nodeId)).toMatchObject({
      long_name: 'FromQr',
      snr: 12.5,
      battery: 91,
      favorited: true,
      last_heard: qrNode.last_heard,
    });
  });
});

describe('importMeshcoreQr', () => {
  beforeEach(() => {
    resetMeshcoreQrImportOwnersForTests();
    vi.mocked(getIdentityNodeMap).mockReturnValue(new Map());
    vi.mocked(syncNodesMapToIdentityStore).mockReset();
    vi.mocked(removeNode).mockReset();
  });

  it('returns channel kind without writing DB', async () => {
    const saveContact = vi.fn();
    const uri = buildMeshcoreChannelAddUri({ name: 'Metro', secretHex: SECRET });
    const result = await importMeshcoreQr(uri, { identityId: 'id-mc', saveContact });
    expect(result).toMatchObject({
      ok: true,
      kind: 'channel',
      toastKey: 'qrIngest.meshcoreChannelImported',
      channel: { name: 'Metro', secretHex: SECRET },
    });
    expect(saveContact).not.toHaveBeenCalled();
  });

  it('imports contact into store and DB and preserves on_radio', async () => {
    const uri = buildMeshcoreContactAddUri({
      name: 'Bob',
      publicKeyHex: PUBKEY,
      type: 2,
    });
    const probe = await importMeshcoreQr(uri, {
      identityId: 'id-mc',
      saveContact: vi.fn().mockResolvedValue(true),
    });
    expect(probe.nodeId).toBeTypeOf('number');
    const nodeId = probe.nodeId!;
    const previous = baseNode({ node_id: nodeId, long_name: 'OldBob' });
    vi.mocked(getIdentityNodeMap).mockReturnValue(new Map([[nodeId, previous]]));
    vi.mocked(syncNodesMapToIdentityStore).mockClear();

    const saveContact = vi.fn().mockResolvedValue(true);
    const skip = vi.fn();
    const result = await importMeshcoreQr(uri, {
      identityId: 'id-mc',
      saveContact,
      skipMountDbHydrationCommit: skip,
    });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('contact');
    expect(result.toastKey).toBe('qrIngest.meshcoreContactImported');
    expect(result.node?.long_name).toBe('Bob');
    expect(result.node?.snr).toBe(7.5);
    expect(result.node?.on_radio).toBe(true);
    expect(skip).toHaveBeenCalled();
    expect(saveContact).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Bob',
        publicKeyHex: PUBKEY,
        contactType: 2,
        onRadio: true,
      }),
    );
    expect(syncNodesMapToIdentityStore).toHaveBeenCalled();
  });

  it('rolls back store when save returns false and removes new contact via removeNode', async () => {
    const saveContact = vi.fn().mockResolvedValue(false);
    const uri = buildMeshcoreContactAddUri({
      name: 'Carol',
      publicKeyHex: PUBKEY,
      type: 1,
    });
    const result = await importMeshcoreQr(uri, { identityId: 'id-mc', saveContact });
    expect(result.ok).toBe(false);
    expect(syncNodesMapToIdentityStore).toHaveBeenCalledTimes(1);
    expect(removeNode).toHaveBeenCalledWith('id-mc', expect.any(Number));
  });

  it('restores previous record when save returns false', async () => {
    const uri = buildMeshcoreContactAddUri({
      name: 'Carol',
      publicKeyHex: PUBKEY,
      type: 1,
    });
    const probe = await importMeshcoreQr(uri, {
      identityId: 'id-mc',
      saveContact: vi.fn().mockResolvedValue(true),
    });
    const nodeId = probe.nodeId!;
    const previous = baseNode({ node_id: nodeId });
    vi.mocked(getIdentityNodeMap).mockReturnValue(new Map([[nodeId, previous]]));
    vi.mocked(syncNodesMapToIdentityStore).mockClear();
    vi.mocked(removeNode).mockClear();

    const result = await importMeshcoreQr(uri, {
      identityId: 'id-mc',
      saveContact: vi.fn().mockResolvedValue(false),
    });
    expect(result.ok).toBe(false);
    expect(removeNode).not.toHaveBeenCalled();
    expect(syncNodesMapToIdentityStore).toHaveBeenCalledTimes(2);
    expect(vi.mocked(syncNodesMapToIdentityStore).mock.calls[1]?.[1]?.get(nodeId)).toEqual(
      previous,
    );
  });

  it('rolls back when save throws', async () => {
    const uri = buildMeshcoreContactAddUri({
      name: 'Dana',
      publicKeyHex: PUBKEY,
      type: 1,
    });
    const probe = await importMeshcoreQr(uri, {
      identityId: 'id-mc',
      saveContact: vi.fn().mockResolvedValue(true),
    });
    const nodeId = probe.nodeId!;
    const previous = baseNode({ node_id: nodeId });
    vi.mocked(getIdentityNodeMap).mockReturnValue(new Map([[nodeId, previous]]));
    vi.mocked(syncNodesMapToIdentityStore).mockClear();

    const result = await importMeshcoreQr(uri, {
      identityId: 'id-mc',
      saveContact: vi.fn().mockRejectedValue(new Error('db down')),
    });
    expect(result.ok).toBe(false);
    expect(vi.mocked(syncNodesMapToIdentityStore).mock.calls.at(-1)?.[1]?.get(nodeId)).toEqual(
      previous,
    );
  });

  it('returns unknownLink for unsupported payload', async () => {
    const result = await importMeshcoreQr('not-a-qr', { identityId: null });
    expect(result).toEqual({
      ok: false,
      kind: 'unsupported',
      toastKey: 'qrIngest.unknownLink',
    });
  });

  it('omits onRadio from save when the store record has no radio membership', async () => {
    const uri = buildMeshcoreContactAddUri({
      name: 'NoFlag',
      publicKeyHex: PUBKEY,
      type: 1,
    });
    const probe = await importMeshcoreQr(uri, {
      identityId: 'id-mc',
      saveContact: vi.fn().mockResolvedValue(true),
    });
    const nodeId = probe.nodeId!;
    const previous = baseNode({ node_id: nodeId });
    delete previous.on_radio;
    vi.mocked(getIdentityNodeMap).mockReturnValue(new Map([[nodeId, previous]]));
    const saveContact = vi.fn().mockResolvedValue(true);
    await importMeshcoreQr(uri, { identityId: 'id-mc', saveContact });
    expect(saveContact.mock.calls[0]?.[0]).not.toHaveProperty('onRadio');
  });

  it('does not roll back a later successful import when an earlier save fails', async () => {
    const uriA = buildMeshcoreContactAddUri({
      name: 'First',
      publicKeyHex: PUBKEY,
      type: 1,
    });
    const uriB = buildMeshcoreContactAddUri({
      name: 'Second',
      publicKeyHex: PUBKEY,
      type: 1,
    });
    const probe = await importMeshcoreQr(uriA, {
      identityId: 'id-mc',
      saveContact: vi.fn().mockResolvedValue(true),
    });
    const nodeId = probe.nodeId!;

    const store = new Map<number, MeshNode>();
    vi.mocked(getIdentityNodeMap).mockImplementation(() => new Map(store));
    vi.mocked(syncNodesMapToIdentityStore).mockImplementation((_id, next) => {
      store.clear();
      for (const [k, v] of next) store.set(k, v);
    });
    vi.mocked(removeNode).mockImplementation((_id, id) => {
      store.delete(id);
    });

    let resolveFirst!: (ok: boolean) => void;
    let resolveSecond!: (ok: boolean) => void;
    const firstSave = new Promise<boolean>((resolve) => {
      resolveFirst = resolve;
    });
    const secondSave = new Promise<boolean>((resolve) => {
      resolveSecond = resolve;
    });
    let saveN = 0;
    const saveContact = vi.fn().mockImplementation(() => {
      saveN += 1;
      return saveN === 1 ? firstSave : secondSave;
    });

    const first = importMeshcoreQr(uriA, { identityId: 'id-mc', saveContact });
    await vi.waitFor(() => {
      expect(saveContact).toHaveBeenCalledTimes(1);
    });
    const second = importMeshcoreQr(uriB, { identityId: 'id-mc', saveContact });
    await vi.waitFor(() => {
      expect(saveContact).toHaveBeenCalledTimes(2);
    });

    resolveSecond(true);
    await expect(second).resolves.toMatchObject({
      ok: true,
      node: expect.objectContaining({ long_name: 'Second' }),
    });
    expect(store.get(nodeId)?.long_name).toBe('Second');

    resolveFirst(false);
    await expect(first).resolves.toMatchObject({ ok: false });
    expect(store.get(nodeId)?.long_name).toBe('Second');
    expect(removeNode).not.toHaveBeenCalled();
  });
});
