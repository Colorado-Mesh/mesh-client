/**
 * Contact JSON import should persist a non-null last_advert so Last heard is not stuck at zero
 * when GPS is present (see meshcore contact last-heard plan).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pubkeyToNodeId } from '../lib/meshcoreUtils';
import { useMeshCore } from './useMeshCore';

/** Pubkey whose XOR-folded node id is non-zero (avoids Map key 0 edge cases in import tests). */
const HEX32 = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';

function pubKeyBytesFromHex(hex: string): Uint8Array {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return b;
}

const IMPORT_NODE_ID = pubkeyToNodeId(pubKeyBytesFromHex(HEX32));

describe('useMeshCore importContacts', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.meshcore.openJsonFile).mockResolvedValue(null);
    vi.mocked(window.electronAPI.db.saveMeshcoreContact).mockResolvedValue(undefined);
  });

  it('sets last_advert to import time for new contacts and passes it to saveMeshcoreContact', async () => {
    vi.mocked(window.electronAPI.meshcore.openJsonFile).mockResolvedValue(
      JSON.stringify([
        {
          name: 'Imported RPT',
          public_key: HEX32,
          latitude: 37.77,
          longitude: -122.42,
        },
      ]),
    );

    const { result } = renderHook(() => useMeshCore());

    let out: Awaited<ReturnType<typeof result.current.importContacts>>;
    await act(async () => {
      out = await result.current.importContacts();
    });

    expect(out!.imported).toBe(1);
    expect(out!.skipped).toBe(0);

    await waitFor(() => {
      expect(window.electronAPI.db.saveMeshcoreContact).toHaveBeenCalled();
    });

    const call = vi.mocked(window.electronAPI.db.saveMeshcoreContact).mock.calls[0][0];
    expect(call.nickname).toBe('Imported RPT');
    expect(call.contact_type).toBe(2);
    expect(typeof call.last_advert).toBe('number');
    expect(call.last_advert).toBeGreaterThan(1_000_000_000);
    expect(call.adv_lat).toBe(37.77);
    expect(call.adv_lon).toBe(-122.42);

    expect(call.node_id).toBe(IMPORT_NODE_ID);
    const node = result.current.nodes.get(IMPORT_NODE_ID);
    expect(node?.last_heard).toBe(call.last_advert);
    expect(node?.latitude).toBe(37.77);
    expect(node?.longitude).toBe(-122.42);
  });

  it('preserves last_heard on re-import when the node already exists (no stale nodesRef)', async () => {
    vi.mocked(window.electronAPI.meshcore.openJsonFile).mockResolvedValue(
      JSON.stringify([
        {
          name: 'First name',
          public_key: HEX32,
          latitude: 40,
          longitude: -74,
        },
      ]),
    );

    const { result } = renderHook(() => useMeshCore());

    await act(async () => {
      await result.current.importContacts();
    });

    const firstHeard = result.current.nodes.get(IMPORT_NODE_ID)?.last_heard;
    expect(firstHeard).toBeDefined();
    expect(firstHeard).toBeGreaterThan(1_000_000_000);

    vi.mocked(window.electronAPI.meshcore.openJsonFile).mockResolvedValue(
      JSON.stringify([
        {
          name: 'Second name',
          public_key: HEX32,
        },
      ]),
    );
    vi.mocked(window.electronAPI.db.saveMeshcoreContact).mockClear();

    await act(async () => {
      await result.current.importContacts();
    });

    expect(result.current.nodes.get(IMPORT_NODE_ID)?.long_name).toBe('Second name');
    expect(result.current.nodes.get(IMPORT_NODE_ID)?.last_heard).toBe(firstHeard);

    await waitFor(() => {
      expect(window.electronAPI.db.saveMeshcoreContact).toHaveBeenCalled();
    });

    const call = vi.mocked(window.electronAPI.db.saveMeshcoreContact).mock.calls[0][0];
    expect(call.last_advert).toBe(firstHeard);
  });
});
