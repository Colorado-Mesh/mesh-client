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
  meshcoreHydratedMessageRecords,
  replaceNodesMapInIdentityStore,
  syncNodesMapToIdentityStore,
} from './hydrateIdentityStoresFromDb';
import { resetIdentityHydrationCoordinatorForTests } from './identityHydrationCoordinator';
import {
  buildMeshcoreChannelIncomingMessage,
  buildMeshcoreRoomIncomingMessage,
} from './meshcoreChannelText';
import { meshcoreMessageStoreId } from './meshcoreStoreDedup';
import { messageRecordsToChatMessages } from './storeRecordAdapters';

const ID_MT = 'id-hydrate-mt';
const ID_MC = 'id-hydrate-mc';
const ID_RT = 'id-hydrate-rt';

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

    expect(useNodeStore.getState().nodes[ID_MT][1].longName).toBe('Alpha');
    expect(Object.keys(useMessageStore.getState().messages[ID_MT] ?? {})).toHaveLength(1);
  });

  it('hydrateMeshtasticNodesFromDb replace mode clears nodes absent from DB', async () => {
    upsertNodeRecordsForIdentity(ID_MT, [
      { nodeId: 1, longName: 'Stale-A' },
      { nodeId: 2, longName: 'Stale-B' },
    ]);
    vi.spyOn(window.electronAPI.db, 'getNodes').mockResolvedValue([]);

    await hydrateMeshtasticNodesFromDb(ID_MT, 'replace');

    expect(useNodeStore.getState().nodes[ID_MT]).toEqual({});
  });

  it('replaceNodesMapInIdentityStore drops ids missing from the map', () => {
    upsertNodeRecordsForIdentity(ID_MT, [
      { nodeId: 1, longName: 'Keep' },
      { nodeId: 2, longName: 'Drop' },
    ]);
    replaceNodesMapInIdentityStore(
      ID_MT,
      new Map([
        [
          1,
          {
            node_id: 1,
            long_name: 'Keep-2',
            short_name: '',
            hw_model: '',
            battery: 0,
            snr: 0,
            rssi: 0,
            last_heard: 0,
            latitude: null,
            longitude: null,
          },
        ],
      ]),
    );
    expect(useNodeStore.getState().nodes[ID_MT][1].longName).toBe('Keep-2');
    expect(useNodeStore.getState().nodes[ID_MT][2]).toBeUndefined();
  });

  it('hydrateMeshtasticNodesFromDb upsert mode leaves prior nodes when DB is empty', async () => {
    upsertNodeRecordsForIdentity(ID_MT, [{ nodeId: 1, longName: 'Stale-A' }]);
    vi.spyOn(window.electronAPI.db, 'getNodes').mockResolvedValue([]);

    await hydrateMeshtasticNodesFromDb(ID_MT, 'upsert');

    expect(useNodeStore.getState().nodes[ID_MT][1].longName).toBe('Stale-A');
  });

  it('hydrateMeshcoreNodesFromDb replace mode clears nodes when contacts are empty', async () => {
    upsertNodeRecordsForIdentity(ID_MC, [{ nodeId: 0xabc, longName: 'Stale-MC' }]);
    vi.spyOn(window.electronAPI.db, 'getMeshcoreIdentityHydration').mockResolvedValue({
      contacts: [],
      nodes: [],
      hopHistory: [],
      messages: [],
    });

    await hydrateMeshcoreNodesFromDb(ID_MC, 'replace');

    expect(useNodeStore.getState().nodes[ID_MC]).toEqual({});
  });

  it('drops a stale empty node replace when a newer hydration finishes first', async () => {
    upsertNodeRecordsForIdentity(ID_MT, [{ nodeId: 1, longName: 'Prior' }]);

    let resolveStale!: (rows: never[]) => void;
    const staleLoad = new Promise<never[]>((resolve) => {
      resolveStale = resolve;
    });
    let getNodesCalls = 0;
    vi.spyOn(window.electronAPI.db, 'getNodes').mockImplementation(() => {
      getNodesCalls += 1;
      if (getNodesCalls === 1) return staleLoad;
      return Promise.resolve([
        {
          node_id: 9,
          long_name: 'Fresh',
          short_name: 'F9',
          hw_model: 'Heltec',
          battery: 50,
          snr: 0,
          rssi: -90,
          last_heard: 1,
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
    });

    const stale = hydrateIdentityStoresFromDb('meshtastic', ID_MT, {
      nodes: true,
      messages: false,
      nodesMode: 'replace',
    });
    const fresh = hydrateIdentityStoresFromDb('meshtastic', ID_MT, {
      nodes: true,
      messages: false,
      nodesMode: 'replace',
    });

    await fresh;
    expect(useNodeStore.getState().nodes[ID_MT][9].longName).toBe('Fresh');

    resolveStale([]);
    await stale;
    expect(useNodeStore.getState().nodes[ID_MT][9].longName).toBe('Fresh');
    expect(useNodeStore.getState().nodes[ID_MT][1]).toBeUndefined();
  });

  it('drops a stale Meshtastic full hydration when a newer one finishes first', async () => {
    upsertMessageRecordsForIdentity(ID_MT, [
      {
        id: 'prior',
        from: 1,
        to: 0xffffffff,
        payload: 'prior',
        channelIndex: 0,
        timestamp: 1000,
        senderName: 'Prior',
      },
    ]);
    upsertNodeRecordsForIdentity(ID_MT, [{ nodeId: 1, longName: 'Prior' }]);

    type HydrationSnap = Awaited<
      ReturnType<typeof window.electronAPI.db.getMeshtasticIdentityHydration>
    >;
    let resolveStale!: (snap: HydrationSnap) => void;
    const staleSnap = new Promise<HydrationSnap>((resolve) => {
      resolveStale = resolve;
    });
    const freshNode = {
      node_id: 9,
      long_name: 'Fresh',
      short_name: 'F9',
      hw_model: 'Heltec',
      battery: 50,
      snr: 0,
      rssi: -90,
      last_heard: 1,
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
    };
    let hydrateCalls = 0;
    vi.spyOn(window.electronAPI.db, 'getMeshtasticIdentityHydration').mockImplementation(() => {
      hydrateCalls += 1;
      if (hydrateCalls === 1) return staleSnap;
      return Promise.resolve({
        nodes: [freshNode],
        meshcoreContacts: [],
        messages: [
          {
            id: 20,
            sender_id: 9,
            sender_name: 'Fresh',
            payload: 'fresh',
            channel: 0,
            timestamp: 3000,
            packetId: null,
            status: 'acked',
            error: null,
            emoji: null,
            replyId: null,
            to: undefined,
            mqttStatus: null,
            receivedVia: null,
          },
        ],
      });
    });

    const stale = hydrateIdentityStoresFromDb('meshtastic', ID_MT, {
      nodes: true,
      messages: true,
      nodesMode: 'replace',
      messagesMode: 'replace',
    });
    const fresh = hydrateIdentityStoresFromDb('meshtastic', ID_MT, {
      nodes: true,
      messages: true,
      nodesMode: 'replace',
      messagesMode: 'replace',
    });

    await fresh;
    const freshMsgIds = Object.keys(useMessageStore.getState().messages[ID_MT] ?? {});
    expect(freshMsgIds).toHaveLength(1);
    expect(freshMsgIds[0]).not.toBe('prior');
    expect(useNodeStore.getState().nodes[ID_MT][9].longName).toBe('Fresh');

    resolveStale({
      nodes: [
        {
          node_id: 1,
          long_name: 'Stale',
          short_name: 'S1',
          hw_model: 'Heltec',
          battery: 10,
          snr: 0,
          rssi: -90,
          last_heard: 1,
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
      ],
      meshcoreContacts: [],
      messages: [
        {
          id: 99,
          sender_id: 1,
          sender_name: 'Stale',
          payload: 'stale',
          channel: 0,
          timestamp: 1500,
          packetId: null,
          status: 'acked',
          error: null,
          emoji: null,
          replyId: null,
          to: undefined,
          mqttStatus: null,
          receivedVia: null,
        },
      ],
    });
    await stale;
    expect(Object.keys(useMessageStore.getState().messages[ID_MT] ?? {})).toEqual(freshMsgIds);
    expect(useNodeStore.getState().nodes[ID_MT][9].longName).toBe('Fresh');
    expect(useNodeStore.getState().nodes[ID_MT][1]).toBeUndefined();
  });

  it('drops a stale MeshCore full hydration when a newer one finishes first', async () => {
    upsertMessageRecordsForIdentity(ID_MC, [
      {
        id: 'prior-mc',
        from: 0xabc,
        to: 0xffffffff,
        payload: 'prior',
        channelIndex: 0,
        timestamp: 1000,
        senderName: 'Prior',
      },
    ]);

    type HydrationSnap = Awaited<
      ReturnType<typeof window.electronAPI.db.getMeshcoreIdentityHydration>
    >;
    let resolveStale!: (snap: HydrationSnap) => void;
    const staleSnap = new Promise<HydrationSnap>((resolve) => {
      resolveStale = resolve;
    });
    let serveFresh = false;
    vi.spyOn(window.electronAPI.db, 'getMeshcoreIdentityHydration').mockImplementation(() => {
      if (!serveFresh) return staleSnap;
      return Promise.resolve({
        contacts: [],
        nodes: [],
        hopHistory: [],
        messages: [
          {
            id: 20,
            sender_id: 0xdef,
            sender_name: 'Fresh',
            payload: 'fresh',
            channel_idx: 0,
            timestamp: 3000,
            status: 'acked',
            packet_id: null,
            emoji: null,
            reply_id: null,
            to_node: null,
          },
        ],
      });
    });

    const stale = hydrateIdentityStoresFromDb('meshcore', ID_MC, {
      nodes: true,
      messages: true,
      nodesMode: 'replace',
      messagesMode: 'replace',
    });
    // Let the stale hydrator's DB awaits park on the deferred snapshot load.
    await Promise.resolve();
    await Promise.resolve();
    serveFresh = true;
    const fresh = hydrateIdentityStoresFromDb('meshcore', ID_MC, {
      nodes: true,
      messages: true,
      nodesMode: 'replace',
      messagesMode: 'replace',
    });

    await fresh;
    const freshMsgIds = Object.keys(useMessageStore.getState().messages[ID_MC] ?? {});
    expect(freshMsgIds).toHaveLength(1);
    expect(freshMsgIds[0]).not.toBe('prior-mc');

    resolveStale({
      contacts: [],
      nodes: [],
      hopHistory: [],
      messages: [
        {
          id: 99,
          sender_id: 0xabc,
          sender_name: 'Stale',
          payload: 'stale',
          channel_idx: 0,
          timestamp: 1500,
          status: 'acked',
          packet_id: null,
          emoji: null,
          reply_id: null,
          to_node: null,
        },
      ],
    });
    await stale;
    expect(Object.keys(useMessageStore.getState().messages[ID_MC] ?? {})).toEqual(freshMsgIds);
  });

  it('hydrates MeshCore contacts and messages into identity-scoped stores', async () => {
    const contact = {
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
    };
    const message = {
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
    };
    vi.spyOn(window.electronAPI.db, 'getMeshcoreIdentityHydration').mockResolvedValue({
      contacts: [contact],
      nodes: [],
      hopHistory: [],
      messages: [message],
    });

    await hydrateMeshcoreNodesFromDb(ID_MC);
    await hydrateMeshcoreMessagesFromDb(ID_MC);

    expect(useNodeStore.getState().nodes[ID_MC][0xabc].longName).toBe('Repeater');
    expect(Object.keys(useMessageStore.getState().messages[ID_MC] ?? {})).toHaveLength(1);
  });

  it('MeshCore DB hydration preserves unread eligibility (no isHistory on persisted rows)', async () => {
    vi.spyOn(window.electronAPI.db, 'getMeshcoreIdentityHydration').mockResolvedValue({
      contacts: [],
      nodes: [],
      hopHistory: [],
      messages: [
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
      ],
    });

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

    // Fair hydrate IPC already returns global ∪ room (and per-channel) rows.
    vi.spyOn(window.electronAPI.db, 'getMeshcoreIdentityHydration').mockResolvedValue({
      contacts: [],
      nodes: [],
      hopHistory: [],
      messages: mergeMeshcoreDbMessageRowsForHydration(channelRows, roomRows),
    });

    await hydrateMeshcoreMessagesFromDb(ID_MC);

    const records = Object.values(useMessageStore.getState().messages[ID_MC] ?? {});
    const roomPosts = messageRecordsToChatMessages(records).filter(
      (m) => m.roomServerId === 0xac200e59,
    );
    expect(roomPosts).toHaveLength(10);
    expect(roomPosts[0]?.payload).toBe('room-post-0');
  });

  it('hydrates quiet group-channel rows that fall outside the global load window', async () => {
    const publicRows = Array.from({ length: 500 }, (_, i) => ({
      id: i + 1,
      sender_id: 0xabc,
      sender_name: 'Public',
      payload: `public-${i}`,
      channel_idx: 0,
      timestamp: 10_000 + i,
      status: 'acked',
      packet_id: null,
      emoji: null,
      reply_id: null,
      to_node: null,
    }));
    const emergencyRows = [
      {
        id: 50,
        sender_id: 0x11,
        sender_name: 'Ops',
        payload: 'emergency history outside global window',
        channel_idx: 1,
        timestamp: 5_000,
        status: 'acked',
        packet_id: null,
        emoji: null,
        reply_id: null,
        to_node: null,
      },
    ];

    vi.spyOn(window.electronAPI.db, 'getMeshcoreIdentityHydration').mockResolvedValue({
      contacts: [],
      nodes: [],
      hopHistory: [],
      messages: mergeMeshcoreDbMessageRowsForHydration(publicRows, emergencyRows),
    });

    await hydrateMeshcoreMessagesFromDb(ID_MC);

    const messages = messageRecordsToChatMessages(
      Object.values(useMessageStore.getState().messages[ID_MC] ?? {}),
    );
    const emergency = messages.filter((m) => m.channel === 1);
    expect(emergency).toHaveLength(1);
    expect(emergency[0]?.payload).toBe('emergency history outside global window');
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
    vi.spyOn(window.electronAPI.db, 'getMeshcoreIdentityHydration').mockResolvedValue({
      contacts: [],
      nodes: [],
      hopHistory: [],
      messages: [
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
      ],
    });

    await hydrateMeshcoreMessagesFromDb(ID_MC);

    const canonicalId = meshcoreMessageStoreId(roomMsg);
    expect(useMessageStore.getState().messages[ID_MC][canonicalId].payload).toBe(
      'persisted room post',
    );
  });

  it('hydrates channel messages under meshcoreMessageStoreId, not sender-ts-channel', () => {
    const channelMsg = buildMeshcoreChannelIncomingMessage([], {
      rawText: 'Half Live: good afternoon from buckley',
      senderId: 2861156262,
      displayName: 'Half Live',
      channel: 0,
      timestamp: 1_700_000_400_000,
      receivedVia: 'rf',
      rxHops: 6,
    });
    const [record] = meshcoreHydratedMessageRecords([channelMsg]);
    expect(record.id).toBe(meshcoreMessageStoreId(channelMsg));
    expect(record.id).not.toBe(
      `${channelMsg.sender_id}-${channelMsg.timestamp}-${channelMsg.channel}`,
    );
    expect(record.meshcoreDedupeKey).toBe('Half Live: good afternoon from buckley');
  });

  it('suffixes colliding channel hydrate ids with the DB row id', () => {
    const tsMs = 1_700_000_401_000;
    const senderId = 0x11;
    const first = {
      ...buildMeshcoreChannelIncomingMessage([], {
        rawText: 'Alice: one',
        senderId,
        displayName: 'Alice',
        channel: 0,
        timestamp: tsMs,
        receivedVia: 'rf' as const,
      }),
      id: 101,
    };
    const second = {
      ...buildMeshcoreChannelIncomingMessage([], {
        rawText: 'Alice: two',
        senderId,
        displayName: 'Alice',
        channel: 0,
        timestamp: tsMs,
        receivedVia: 'rf' as const,
      }),
      id: 102,
    };
    const [a, b] = meshcoreHydratedMessageRecords([first, second]);
    const baseId = meshcoreMessageStoreId(first);
    expect(a.id).toBe(baseId);
    expect(b.id).toBe(`${baseId}:102`);
  });

  it('dispatches by protocol via hydrateIdentityStoresFromDb', async () => {
    const getMt = vi
      .spyOn(window.electronAPI.db, 'getMeshtasticIdentityHydration')
      .mockResolvedValue({
        nodes: [],
        meshcoreContacts: [],
        messages: [],
      });
    const getMc = vi
      .spyOn(window.electronAPI.db, 'getMeshcoreIdentityHydration')
      .mockResolvedValue({
        contacts: [],
        nodes: [],
        hopHistory: [],
        messages: [],
      });

    await hydrateIdentityStoresFromDb('meshtastic', ID_MT, { nodes: true, messages: true });
    await hydrateIdentityStoresFromDb('meshcore', ID_MC, { nodes: true, messages: true });

    expect(getMt).toHaveBeenCalled();
    expect(getMc).toHaveBeenCalled();
  });

  it('syncNodesMapToIdentityStore upserts MeshCore runtime node map into Zustand', () => {
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

    syncNodesMapToIdentityStore(ID_MC, nodes);

    const byId = useNodeStore.getState().nodes[ID_MC];
    expect(Object.keys(byId)).toHaveLength(2);
    expect(byId[0xabc].hwModel).toBe('Repeater');
    expect(byId[0xabc].favorited).toBe(true);
    expect(byId[0xdef].longName).toBe('Chat-B');
  });

  it('syncNodesMapToIdentityStore upserts Meshtastic runtime node map into Zustand', () => {
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
    syncNodesMapToIdentityStore(ID_MT, nodes);
    expect(useNodeStore.getState().nodes[ID_MT][0x11].longName).toBe('Node-A');
  });

  it('syncNodesMapToIdentityStore monotonicLastHeard keeps fresher store lastHeardAt (rebooted repeater RTC)', () => {
    const nowSec = 1_791_501_107;
    const staleSec = nowSec - 220 * 86_400;
    upsertNodeRecordsForIdentity(ID_MC, [
      { nodeId: 0xabc, longName: 'JC MINI RPTR 1', lastHeardAt: nowSec, hopsAway: 3 },
      { nodeId: 0xdef, longName: 'Older', lastHeardAt: staleSec },
    ]);
    const runtimeNode = (nodeId: number, lastHeard: number, hops: number) => ({
      node_id: nodeId,
      long_name: 'Renamed',
      short_name: '',
      hw_model: 'Repeater',
      battery: 0,
      snr: 11.5,
      rssi: -27,
      last_heard: lastHeard,
      latitude: null,
      longitude: null,
      hops_away: hops,
    });
    const nodes = new Map([
      [0xabc, runtimeNode(0xabc, staleSec, 0)],
      [0xdef, runtimeNode(0xdef, nowSec, 1)],
    ]);

    syncNodesMapToIdentityStore(ID_MC, nodes, { monotonicLastHeard: true });

    const byId = useNodeStore.getState().nodes[ID_MC];
    expect(byId[0xabc].lastHeardAt).toBe(nowSec);
    expect(byId[0xabc].hopsAway).toBe(0);
    expect(byId[0xabc].longName).toBe('Renamed');
    expect(byId[0xdef].lastHeardAt).toBe(nowSec);
  });

  it('syncNodesMapToIdentityStore without monotonicLastHeard still applies the runtime value', () => {
    upsertNodeRecordsForIdentity(ID_MT, [{ nodeId: 0x11, lastHeardAt: 5000 }]);
    syncNodesMapToIdentityStore(
      ID_MT,
      new Map([
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
      ]),
    );
    expect(useNodeStore.getState().nodes[ID_MT][0x11].lastHeardAt).toBe(1000);
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

  it('skips Reticulum destination rows with an unusable hash and keeps the valid ones', async () => {
    const validHash = 'a'.repeat(32);
    vi.spyOn(window.electronAPI.db, 'getReticulumIdentityHydration').mockResolvedValue({
      destinations: [
        { destination_hash: validHash, display_name: 'Peer', last_heard: 1000 },
        { destination_hash: null },
        { destination_hash: 'not-a-hash' },
        { destination_hash: 42 as unknown as string },
      ],
      messages: [],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await hydrateIdentityStoresFromDb('reticulum', ID_RT);

    const nodes = Object.values(useNodeStore.getState().nodes[ID_RT] ?? {});
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.reticulumDestinationHash).toBe(validHash);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('normalizes uppercase Reticulum destination hashes', async () => {
    const upper = 'B'.repeat(32);
    vi.spyOn(window.electronAPI.db, 'getReticulumIdentityHydration').mockResolvedValue({
      destinations: [{ destination_hash: upper }],
      messages: [],
    });

    await hydrateIdentityStoresFromDb('reticulum', ID_RT);

    const nodes = Object.values(useNodeStore.getState().nodes[ID_RT] ?? {});
    expect(nodes[0]?.reticulumDestinationHash).toBe(upper.toLowerCase());
  });

  it('upsertNodeRecordsForIdentity merges large batches in one store update', () => {
    const records = Array.from({ length: 350 }, (_, i) => ({
      nodeId: i + 1,
      hwModel: i % 2 === 0 ? 'Repeater' : 'Chat',
    }));

    upsertNodeRecordsForIdentity(ID_MC, records);

    const byId = useNodeStore.getState().nodes[ID_MC];
    expect(Object.keys(byId)).toHaveLength(350);
    expect(byId[1].hwModel).toBe('Repeater');
    expect(byId[2].hwModel).toBe('Chat');
  });
});
