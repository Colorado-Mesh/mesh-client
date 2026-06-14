import { describe, expect, it } from 'vitest';

import type { MeshcoreContactDbRow } from '../../lib/meshcore/meshcoreHookTypes';
import { pubkeyToNodeId } from '../../lib/meshcoreUtils';
import { buildMeshcoreNodeMapFromDb } from './meshcoreHookPreamble';

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
});
