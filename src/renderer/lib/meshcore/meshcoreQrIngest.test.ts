import { beforeEach, describe, expect, it, vi } from 'vitest';

import { syncNodesMapToIdentityStore } from '@/renderer/lib/hydrateIdentityStoresFromDb';
import { getIdentityNodeMap } from '@/renderer/lib/identityStoreReads';
import {
  classifyMeshcoreQr,
  importMeshcoreQr,
  mergeMeshcoreQrContactNode,
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
});

describe('importMeshcoreQr', () => {
  beforeEach(() => {
    vi.mocked(getIdentityNodeMap).mockReturnValue(new Map());
    vi.mocked(syncNodesMapToIdentityStore).mockClear();
    vi.mocked(removeNode).mockClear();
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
});
