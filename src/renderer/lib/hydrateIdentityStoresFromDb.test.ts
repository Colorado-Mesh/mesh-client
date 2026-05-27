import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import {
  hydrateIdentityStoresFromDb,
  hydrateMeshcoreMessagesFromDb,
  hydrateMeshcoreNodesFromDb,
  hydrateMeshtasticMessagesFromDb,
  hydrateMeshtasticNodesFromDb,
} from './hydrateIdentityStoresFromDb';

const ID_MT = 'id-hydrate-mt';
const ID_MC = 'id-hydrate-mc';

describe('hydrateIdentityStoresFromDb', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {} });
    useMessageStore.setState({ messages: {} });
    vi.restoreAllMocks();
  });

  it('hydrates Meshtastic nodes and messages into identity-scoped stores', async () => {
    vi.spyOn(window.electronAPI.db, 'getNodes').mockResolvedValue([
      {
        node_id: 1,
        long_name: 'Alpha',
        short_name: 'A1',
        hw_model: 'T-Beam',
        battery: 90,
        snr: 1,
        rssi: -80,
        last_heard: 1000,
        latitude: null,
        longitude: null,
        favorited: false,
      },
    ]);
    vi.spyOn(window.electronAPI.db, 'getMessages').mockResolvedValue([
      {
        id: 10,
        sender_id: 1,
        sender_name: 'Alpha',
        payload: 'hi',
        channel: 0,
        timestamp: 2000,
        status: 'acked',
      },
    ]);

    await hydrateMeshtasticNodesFromDb(ID_MT);
    await hydrateMeshtasticMessagesFromDb(ID_MT);

    expect(useNodeStore.getState().nodes[ID_MT]?.[1]?.longName).toBe('Alpha');
    expect(Object.keys(useMessageStore.getState().messages[ID_MT] ?? {})).toHaveLength(1);
  });

  it('hydrates MeshCore contacts and messages into identity-scoped stores', async () => {
    vi.spyOn(window.electronAPI.db, 'getMeshcoreContacts').mockResolvedValue([
      {
        node_id: 0xabc,
        public_key: 'aa'.repeat(32),
        adv_name: 'Repeater',
        contact_type: 2,
        last_advert: 5000,
        adv_lat: null,
        adv_lon: null,
        last_snr: 2,
        last_rssi: -70,
        favorited: 0,
        nickname: null,
        contact_flags: null,
        hops_away: 1,
        on_radio: 0,
        last_synced_from_radio: null,
      },
    ]);
    vi.spyOn(window.electronAPI.db, 'getNodes').mockResolvedValue([]);
    vi.spyOn(window.electronAPI.db, 'getMeshcoreMessages').mockResolvedValue([
      {
        id: 3,
        sender_id: 0xabc,
        sender_name: 'Repeater',
        payload: 'ping',
        channel_idx: 0,
        timestamp: 6000,
        status: 'acked',
        packet_id: null,
        emoji: null,
        reply_id: null,
        to_node: null,
      },
    ]);

    await hydrateMeshcoreNodesFromDb(ID_MC);
    await hydrateMeshcoreMessagesFromDb(ID_MC);

    expect(useNodeStore.getState().nodes[ID_MC]?.[0xabc]?.longName).toBe('Repeater');
    expect(Object.keys(useMessageStore.getState().messages[ID_MC] ?? {})).toHaveLength(1);
  });

  it('dispatches by protocol via hydrateIdentityStoresFromDb', async () => {
    const getNodes = vi.spyOn(window.electronAPI.db, 'getNodes').mockResolvedValue([]);
    const getMeshcoreContacts = vi
      .spyOn(window.electronAPI.db, 'getMeshcoreContacts')
      .mockResolvedValue([]);
    vi.spyOn(window.electronAPI.db, 'getMessages').mockResolvedValue([]);
    vi.spyOn(window.electronAPI.db, 'getMeshcoreMessages').mockResolvedValue([]);

    await hydrateIdentityStoresFromDb('meshtastic', ID_MT, { nodes: true, messages: true });
    await hydrateIdentityStoresFromDb('meshcore', ID_MC, { nodes: true, messages: true });

    expect(getNodes).toHaveBeenCalled();
    expect(getMeshcoreContacts).toHaveBeenCalled();
  });
});
