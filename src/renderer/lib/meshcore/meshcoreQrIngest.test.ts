import { beforeEach, describe, expect, it, vi } from 'vitest';

import { syncNodesMapToIdentityStore } from '@/renderer/lib/hydrateIdentityStoresFromDb';
import { getIdentityNodeMap } from '@/renderer/lib/identityStoreReads';
import { classifyMeshcoreQr, importMeshcoreQr } from '@/renderer/lib/meshcore/meshcoreQrIngest';
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

/** Non-repeating hex so pubkeyToNodeId is non-zero (periodic/all-identical bytes XOR to 0). */
const PUBKEY = '00112233445566778899aabbccddeeff0102030405060708090a0b0c0d0e0f10';
const SECRET = 'b'.repeat(32);

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

describe('importMeshcoreQr', () => {
  beforeEach(() => {
    vi.mocked(getIdentityNodeMap).mockReturnValue(new Map());
    vi.mocked(syncNodesMapToIdentityStore).mockClear();
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

  it('imports contact into store and DB', async () => {
    const saveContact = vi.fn().mockResolvedValue(true);
    const skip = vi.fn();
    const uri = buildMeshcoreContactAddUri({
      name: 'Bob',
      publicKeyHex: PUBKEY,
      type: 2,
    });
    const result = await importMeshcoreQr(uri, {
      identityId: 'id-mc',
      saveContact,
      skipMountDbHydrationCommit: skip,
    });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('contact');
    expect(result.toastKey).toBe('qrIngest.meshcoreContactImported');
    expect(result.nodeId).toBeTypeOf('number');
    expect(result.node?.long_name).toBe('Bob');
    expect(result.node?.hw_model).toBe('Repeater');
    expect(skip).toHaveBeenCalled();
    expect(saveContact).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Bob',
        publicKeyHex: PUBKEY,
        contactType: 2,
      }),
    );
    expect(syncNodesMapToIdentityStore).toHaveBeenCalled();
  });

  it('rolls back store when save fails', async () => {
    const saveContact = vi.fn().mockResolvedValue(false);
    const uri = buildMeshcoreContactAddUri({
      name: 'Carol',
      publicKeyHex: PUBKEY,
      type: 1,
    });
    const result = await importMeshcoreQr(uri, { identityId: 'id-mc', saveContact });
    expect(result.ok).toBe(false);
    expect(syncNodesMapToIdentityStore).toHaveBeenCalledTimes(2);
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
