import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearMeshcorePubKeyRegistry,
  registerMeshcorePubKey,
} from '../../lib/meshcore/meshcorePubKeyRegistry';
import { pubkeyToNodeId } from '../../lib/meshcoreUtils';
import {
  reloadMeshcorePubKeyIfNodeIdMismatch,
  resolveMeshcoreNodePubKey,
} from './meshcoreHookPreamble';

const PEER_PUBKEY_HEX = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';

function pubKeyBytesFromHex(hex: string): Uint8Array {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return b;
}

const PEER_NODE_ID = pubkeyToNodeId(pubKeyBytesFromHex(PEER_PUBKEY_HEX));
const PEER_PUBKEY = pubKeyBytesFromHex(PEER_PUBKEY_HEX);

describe('resolveMeshcoreNodePubKey', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.db.getMeshcoreContactById).mockResolvedValue(null);
    clearMeshcorePubKeyRegistry();
  });

  it('returns pubkey from the runtime map when present', async () => {
    const map = new Map([[PEER_NODE_ID, PEER_PUBKEY]]);
    await expect(resolveMeshcoreNodePubKey(PEER_NODE_ID, map)).resolves.toEqual(PEER_PUBKEY);
    expect(window.electronAPI.db.getMeshcoreContactById).not.toHaveBeenCalled();
  });

  it('falls back to the identity store pubkey when the map is empty', async () => {
    await expect(resolveMeshcoreNodePubKey(PEER_NODE_ID, new Map(), PEER_PUBKEY)).resolves.toEqual(
      PEER_PUBKEY,
    );
    expect(window.electronAPI.db.getMeshcoreContactById).not.toHaveBeenCalled();
  });

  it('falls back to the global pubkey registry when map and store are empty', async () => {
    registerMeshcorePubKey(PEER_NODE_ID, PEER_PUBKEY);

    await expect(resolveMeshcoreNodePubKey(PEER_NODE_ID, new Map())).resolves.toEqual(PEER_PUBKEY);
    expect(window.electronAPI.db.getMeshcoreContactById).not.toHaveBeenCalled();
  });

  it('loads pubkey from SQLite when map and store are empty', async () => {
    vi.mocked(window.electronAPI.db.getMeshcoreContactById).mockResolvedValue({
      public_key: PEER_PUBKEY_HEX,
    } as { node_id: number; public_key: string; on_radio: number });

    await expect(resolveMeshcoreNodePubKey(PEER_NODE_ID, new Map())).resolves.toEqual(PEER_PUBKEY);
    expect(window.electronAPI.db.getMeshcoreContactById).toHaveBeenCalledWith(PEER_NODE_ID);
  });

  it('ignores a SQLite pubkey that does not hash to nodeId', async () => {
    const mismatched = new Uint8Array(32);
    mismatched.fill(0xab);
    const mismatchedHex = Array.from(mismatched)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(pubkeyToNodeId(mismatched)).not.toBe(PEER_NODE_ID);
    vi.mocked(window.electronAPI.db.getMeshcoreContactById).mockResolvedValue({
      public_key: mismatchedHex,
    } as { node_id: number; public_key: string; on_radio: number });

    await expect(resolveMeshcoreNodePubKey(PEER_NODE_ID, new Map())).resolves.toBeNull();
  });

  it('ignores a map key that does not hash to nodeId and loads from SQLite', async () => {
    const mismatched = new Uint8Array(32);
    mismatched.fill(0xab);
    expect(pubkeyToNodeId(mismatched)).not.toBe(PEER_NODE_ID);
    vi.mocked(window.electronAPI.db.getMeshcoreContactById).mockResolvedValue({
      public_key: PEER_PUBKEY_HEX,
    } as { node_id: number; public_key: string; on_radio: number });

    const map = new Map([[PEER_NODE_ID, mismatched]]);
    await expect(resolveMeshcoreNodePubKey(PEER_NODE_ID, map)).resolves.toEqual(PEER_PUBKEY);
    expect(window.electronAPI.db.getMeshcoreContactById).toHaveBeenCalledWith(PEER_NODE_ID);
  });
});

describe('reloadMeshcorePubKeyIfNodeIdMismatch', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.db.getMeshcoreContactById).mockResolvedValue(null);
    clearMeshcorePubKeyRegistry();
  });

  it('returns the same key when it already matches nodeId', async () => {
    const map = new Map([[PEER_NODE_ID, PEER_PUBKEY]]);
    await expect(
      reloadMeshcorePubKeyIfNodeIdMismatch(PEER_NODE_ID, PEER_PUBKEY, map, 'test'),
    ).resolves.toEqual(PEER_PUBKEY);
  });

  it('replaces a mismatched map key from SQLite', async () => {
    const mismatched = new Uint8Array(32);
    mismatched.fill(0xcd);
    const map = new Map([[PEER_NODE_ID, mismatched]]);
    vi.mocked(window.electronAPI.db.getMeshcoreContactById).mockResolvedValue({
      public_key: PEER_PUBKEY_HEX,
    } as { node_id: number; public_key: string; on_radio: number });

    const resolved = await reloadMeshcorePubKeyIfNodeIdMismatch(
      PEER_NODE_ID,
      mismatched,
      map,
      'test',
    );
    expect(resolved).toEqual(PEER_PUBKEY);
    expect(map.get(PEER_NODE_ID)).toEqual(PEER_PUBKEY);
  });

  it('throws when no matching key can be loaded', async () => {
    const mismatched = new Uint8Array(32);
    mismatched.fill(0xee);
    const map = new Map([[PEER_NODE_ID, mismatched]]);
    await expect(
      reloadMeshcorePubKeyIfNodeIdMismatch(PEER_NODE_ID, mismatched, map, 'test'),
    ).rejects.toThrow(/Room key out of sync/);
  });
});
