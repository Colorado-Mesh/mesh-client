import { describe, expect, it, vi } from 'vitest';

import { GPS_SETTINGS_STORAGE_KEY } from '../../lib/gpsSource';
import type { MeshcoreContactDbRow } from '../../lib/meshcore/meshcoreHookTypes';
import { pubkeyToNodeId } from '../../lib/meshcoreUtils';
import { buildMeshcoreNodeMapFromDb } from './meshcoreHookPreamble';

function stubMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: () => null,
    get length() {
      return store.size;
    },
  });
}

const REMOTE_PUBKEY = (() => {
  const b = new Uint8Array(32);
  b[0] = 0x55;
  b[31] = 0x66;
  return b;
})();
const REMOTE_NODE_ID = pubkeyToNodeId(REMOTE_PUBKEY);
const REMOTE_PUBKEY_HEX = Array.from(REMOTE_PUBKEY)
  .map((x) => x.toString(16).padStart(2, '0'))
  .join('');

describe('buildMeshcoreNodeMapFromDb', () => {
  it('preserves hops_away from meshcore_contacts rows', () => {
    const contact: MeshcoreContactDbRow = {
      node_id: REMOTE_NODE_ID,
      public_key: REMOTE_PUBKEY_HEX,
      adv_name: 'RemoteInit',
      contact_type: 2,
      last_advert: 1_700_000_000,
      adv_lat: null,
      adv_lon: null,
      last_snr: 0,
      last_rssi: 0,
      favorited: 0,
      nickname: null,
      hops_away: 4,
      contact_flags: null,
      on_radio: 0,
      last_synced_from_radio: null,
    };
    const map = buildMeshcoreNodeMapFromDb([contact], [], []);
    expect(map.get(REMOTE_NODE_ID)?.hops_away).toBe(4);
  });

  it('merges hops from nodes table when contact exists without hops_away', () => {
    const contact: MeshcoreContactDbRow = {
      node_id: REMOTE_NODE_ID,
      public_key: REMOTE_PUBKEY_HEX,
      adv_name: 'RemoteInit',
      contact_type: 2,
      last_advert: 1_700_000_000,
      adv_lat: null,
      adv_lon: null,
      last_snr: 0,
      last_rssi: 0,
      favorited: 0,
      nickname: null,
      hops_away: null,
      contact_flags: null,
      on_radio: 0,
      last_synced_from_radio: null,
    };
    const map = buildMeshcoreNodeMapFromDb(
      [contact],
      [{ node_id: REMOTE_NODE_ID, hops: 7, hops_away: null }],
      [],
    );
    expect(map.get(REMOTE_NODE_ID)?.hops_away).toBe(7);
  });

  it('ignores repeater uptime stored as last_advert and invalid GPS', () => {
    const contact: MeshcoreContactDbRow = {
      node_id: REMOTE_NODE_ID,
      public_key: REMOTE_PUBKEY_HEX,
      adv_name: 'BadRepeater',
      contact_type: 2,
      last_advert: 6,
      adv_lat: 34.0,
      adv_lon: 2147.48,
      last_snr: 0,
      last_rssi: 0,
      favorited: 0,
      nickname: null,
      hops_away: null,
      contact_flags: null,
      on_radio: 1,
      last_synced_from_radio: null,
    };
    const map = buildMeshcoreNodeMapFromDb([contact], [], []);
    const node = map.get(REMOTE_NODE_ID);
    expect(node?.last_heard).toBe(0);
    expect(node?.latitude).toBeNull();
    expect(node?.longitude).toBeNull();
  });

  it('overlays App static GPS onto the self-node from DB advert coords', () => {
    stubMemoryLocalStorage();
    try {
      localStorage.setItem(
        GPS_SETTINGS_STORAGE_KEY,
        JSON.stringify({ staticLat: 41.59375, staticLon: -73.02428 }),
      );
      const selfId = 0x11112222;
      const contact: MeshcoreContactDbRow = {
        node_id: selfId,
        public_key: 'aa'.repeat(32),
        adv_name: 'Self',
        contact_type: 1,
        last_advert: 1_700_000_000,
        adv_lat: 40.0,
        adv_lon: -74.0,
        last_snr: 0,
        last_rssi: 0,
        favorited: 0,
        nickname: null,
        hops_away: 0,
        contact_flags: null,
        on_radio: 1,
        last_synced_from_radio: null,
      };
      const map = buildMeshcoreNodeMapFromDb([contact], [], [], selfId);
      expect(map.get(selfId)?.latitude).toBe(41.59375);
      expect(map.get(selfId)?.longitude).toBe(-73.02428);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
