import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MESHCORE_ROOM_MESSAGE_CHANNEL } from '../hooks/meshcore/meshcoreHookPreamble';
import { upsertMessageRecordsForIdentity, useMessageStore } from '../stores/messageStore';
import { upsertNodeRecordsForIdentity, useNodeStore } from '../stores/nodeStore';
import { totalUnreadCount } from './chatUnreadCounts';
import {
  hydrateIdentityStoresFromDb,
  hydrateMeshcoreMessagesFromDb,
  hydrateMeshcoreNodesFromDb,
  hydrateMeshtasticMessagesFromDb,
  hydrateMeshtasticNodesFromDb,
  mergeMeshcoreDbMessageRowsForHydration,
  MESHCORE_DB_ROOM_MESSAGE_LOAD_LIMIT,
  syncMeshcoreNodesMapToIdentityStore,
  syncMeshtasticNodesMapToIdentityStore,
} from './hydrateIdentityStoresFromDb';
import { resetIdentityHydrationCoordinatorForTests } from './identityHydrationCoordinator';
import { buildMeshcoreRoomIncomingMessage } from './meshcoreChannelText';
import { meshcoreMessageStoreId } from './meshcoreStoreDedup';
import { messageRecordsToChatMessages } from './storeRecordAdapters';

const ID_MT = 'id-hydrate-mt';
const ID_MC = 'id-hydrate-mc';

describe('hydrateIdentityStoresFromDb', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {} });
    useMessageStore.setState({ messages: {} });
    resetIdentityHydrationCoordinatorForTests();
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
        role: null,
        hops_away: null,
        via_mqtt: null,
        voltage: null,
        channel_utilization: null,
        air_util_tx: null,
        altitude: null,
        favorited: 0,
        source: 'rf',
        num_packets_rx_bad: null,
        num_rx_dupe: null,
        num_packets_rx: null,
        num_packets_tx: null,
        hops: null,
        path: null,
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
        packetId: null,
        status: 'acked',
        error: null,
        emoji: null,
        replyId: null,
        to: undefined,
        mqttStatus: null,
        receivedVia: null,
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

  it('MeshCore DB hydration preserves unread eligibility (no isHistory on persisted rows)', async () => {
    vi.spyOn(window.electronAPI.db, 'getMeshcoreContacts').mockResolvedValue([]);
    vi.spyOn(window.electronAPI.db, 'getNodes').mockResolvedValue([]);
    vi.spyOn(window.electronAPI.db, 'getMeshcoreMessages').mockResolvedValue([
      {
        id: 7,
        sender_id: 0xdef,
        sender_name: 'Alice',
        payload: 'unread after restart',
        channel_idx: 1,
        timestamp: 9000,
        status: 'acked',
        packet_id: null,
        emoji: null,
        reply_id: null,
        to_node: null,
      },
    ]);

    await hydrateMeshcoreMessagesFromDb(ID_MC);

    const records = Object.values(useMessageStore.getState().messages[ID_MC] ?? {});
    const messages = messageRecordsToChatMessages(records);
    expect(messages[0]?.isHistory).toBeUndefined();

    const ownNodes = new Set([1]);
    const unread = totalUnreadCount(messages, { 'ch:1': 1000 }, ownNodes, 'meshcore');
    expect(unread).toBe(1);
  });

  it('merges room channel rows into hydration beyond the global load window', async () => {
    const channelRows = Array.from({ length: 600 }, (_, i) => ({
      id: i + 1,
      sender_id: 0xabc,
      sender_name: 'Repeater',
      payload: `channel-${i}`,
      channel_idx: 0,
      timestamp: 10_000 + i,
      status: 'acked',
      packet_id: null,
      emoji: null,
      reply_id: null,
      to_node: null,
    }));
    const roomRows = Array.from({ length: 10 }, (_, i) => ({
      id: 700 + i,
      sender_id: 0x33,
      sender_name: 'Poster',
      payload: `room-post-${i}`,
      channel_idx: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: 20_000 + i,
      status: 'acked',
      packet_id: null,
      emoji: null,
      reply_id: null,
      to_node: 0xac200e59,
      room_server_id: 0xac200e59,
    }));

    expect(mergeMeshcoreDbMessageRowsForHydration(channelRows, roomRows)).toHaveLength(610);

    vi.spyOn(window.electronAPI.db, 'getMeshcoreContacts').mockResolvedValue([]);
    vi.spyOn(window.electronAPI.db, 'getMeshcoreMessages').mockImplementation((channelIdx) => {
      if (channelIdx === MESHCORE_ROOM_MESSAGE_CHANNEL) {
        return Promise.resolve(roomRows.slice(0, MESHCORE_DB_ROOM_MESSAGE_LOAD_LIMIT));
      }
      return Promise.resolve(channelRows);
    });

    await hydrateMeshcoreMessagesFromDb(ID_MC);

    const records = Object.values(useMessageStore.getState().messages[ID_MC] ?? {});
    const roomPosts = messageRecordsToChatMessages(records).filter(
      (m) => m.roomServerId === 0xac200e59,
    );
    expect(roomPosts).toHaveLength(10);
    expect(roomPosts[0]?.payload).toBe('room-post-0');
  });

  it('assigns author-inclusive canonical ids to hydrated room posts', async () => {
    const roomMsg = buildMeshcoreRoomIncomingMessage({
      rawText: 'persisted room post',
      roomServerId: 0xac200e59,
      authorId: 0x33,
      authorName: 'NV0N 01',
      timestamp: 1_700_000_300_000,
      receivedVia: 'rf',
    });
    vi.spyOn(window.electronAPI.db, 'getMeshcoreContacts').mockResolvedValue([]);
    vi.spyOn(window.electronAPI.db, 'getMeshcoreMessages').mockResolvedValue([
      {
        id: 99,
        sender_id: roomMsg.sender_id,
        sender_name: roomMsg.sender_name,
        payload: roomMsg.payload,
        channel_idx: MESHCORE_ROOM_MESSAGE_CHANNEL,
        timestamp: roomMsg.timestamp,
        status: 'acked',
        packet_id: null,
        emoji: null,
        reply_id: null,
        to_node: 0xac200e59,
        room_server_id: 0xac200e59,
      },
    ]);

    await hydrateMeshcoreMessagesFromDb(ID_MC);

    const canonicalId = meshcoreMessageStoreId(roomMsg);
    expect(useMessageStore.getState().messages[ID_MC]?.[canonicalId]?.payload).toBe(
      'persisted room post',
    );
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

  it('syncMeshcoreNodesMapToIdentityStore upserts runtime node map into Zustand', () => {
    const nodes = new Map([
      [
        0xabc,
        {
          node_id: 0xabc,
          long_name: 'Repeater-A',
          short_name: '',
          hw_model: 'Repeater',
          battery: 0,
          snr: 1,
          rssi: -70,
          last_heard: 1000,
          latitude: null,
          longitude: null,
          favorited: true,
        },
      ],
      [
        0xdef,
        {
          node_id: 0xdef,
          long_name: 'Chat-B',
          short_name: '',
          hw_model: 'Chat',
          battery: 0,
          snr: 0,
          rssi: 0,
          last_heard: 2000,
          latitude: null,
          longitude: null,
        },
      ],
    ]);

    syncMeshcoreNodesMapToIdentityStore(ID_MC, nodes);

    const byId = useNodeStore.getState().nodes[ID_MC];
    expect(Object.keys(byId ?? {})).toHaveLength(2);
    expect(byId?.[0xabc]?.hwModel).toBe('Repeater');
    expect(byId?.[0xabc]?.favorited).toBe(true);
    expect(byId?.[0xdef]?.longName).toBe('Chat-B');
  });

  it('syncMeshtasticNodesMapToIdentityStore upserts runtime node map into Zustand', () => {
    const nodes = new Map([
      [
        0x11,
        {
          node_id: 0x11,
          long_name: 'Node-A',
          short_name: 'NA',
          hw_model: 'T-Beam',
          battery: 0,
          snr: 0,
          rssi: 0,
          last_heard: 1000,
          latitude: null,
          longitude: null,
        },
      ],
    ]);
    syncMeshtasticNodesMapToIdentityStore(ID_MT, nodes);
    expect(useNodeStore.getState().nodes[ID_MT]?.[0x11]?.longName).toBe('Node-A');
  });

  it('upsertMessageRecordsForIdentity merges large batches in one store update', () => {
    const records = Array.from({ length: 200 }, (_, i) => ({
      id: String(i + 1),
      from: 1,
      to: 0xffffffff,
      payload: `m${i}`,
      channelIndex: 0,
      timestamp: i,
    }));
    upsertMessageRecordsForIdentity(ID_MT, records);
    expect(Object.keys(useMessageStore.getState().messages[ID_MT] ?? {})).toHaveLength(200);
  });

  it('upsertNodeRecordsForIdentity merges large batches in one store update', () => {
    const records = Array.from({ length: 350 }, (_, i) => ({
      nodeId: i + 1,
      hwModel: i % 2 === 0 ? 'Repeater' : 'Chat',
    }));

    upsertNodeRecordsForIdentity(ID_MC, records);

    const byId = useNodeStore.getState().nodes[ID_MC];
    expect(Object.keys(byId ?? {})).toHaveLength(350);
    expect(byId?.[1]?.hwModel).toBe('Repeater');
    expect(byId?.[2]?.hwModel).toBe('Chat');
  });
});
