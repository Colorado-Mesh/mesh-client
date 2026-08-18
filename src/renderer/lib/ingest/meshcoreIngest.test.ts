import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addIdentity } from '../../stores/identityStore';
import { upsertMessage, useMessageStore } from '../../stores/messageStore';
import { useNodeStore } from '../../stores/nodeStore';
import { packetRouter } from '../drivers/PacketRouter';
import {
  MESHCORE_UNKNOWN_SENDER_STUB_ID,
  meshcoreChatStubNodeIdFromDisplayName,
  pubkeyToNodeId,
} from '../meshcoreUtils';
import { getNodeStatus } from '../nodeStatus';
import { meshcoreProtocol } from '../protocols/MeshCoreProtocol';
import { messageRecordToChatMessage } from '../storeRecordAdapters';
import { attachMeshcoreIngest, meshcoreIngestHandleTextMessage } from './meshcoreIngest';

const ID = 'meshcore-ingest-test';

describe('attachMeshcoreIngest', () => {
  const saveNode = vi.fn().mockResolvedValue(undefined);
  const saveMeshcoreMessage = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.spyOn(window.electronAPI.db, 'saveNode').mockImplementation(saveNode);
    vi.spyOn(window.electronAPI.db, 'saveMeshcoreMessage').mockImplementation(saveMeshcoreMessage);
    saveNode.mockClear();
    saveMeshcoreMessage.mockClear();
    useMessageStore.setState({ messages: {} });
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    addIdentity({
      id: ID,
      protocol: meshcoreProtocol,
      signature: 'meshcore:ingest-test',
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
  });

  afterEach(() => {
    useMessageStore.setState({ messages: {} });
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    vi.restoreAllMocks();
  });

  it('does not write MeshCore contacts into the Meshtastic nodes table', () => {
    const detach = attachMeshcoreIngest(ID);
    packetRouter.dispatch(
      {
        type: 'node_info',
        payload: { nodeId: 42, longName: 'Repeater', shortName: 'RP' },
      },
      ID,
    );
    expect(saveNode).not.toHaveBeenCalled();
    detach();
  });

  it('persists live advert node_info to meshcore_contacts with publicKey', () => {
    const saveMeshcoreContact = vi.fn().mockResolvedValue(undefined);
    const updateAdvert = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window.electronAPI.db, 'saveMeshcoreContact').mockImplementation(saveMeshcoreContact);
    vi.spyOn(window.electronAPI.db, 'updateMeshcoreContactAdvert').mockImplementation(updateAdvert);
    const pk = new Uint8Array(32);
    for (let i = 0; i < 32; i++) pk[i] = i + 1;
    const nid = pubkeyToNodeId(pk);
    expect(nid).not.toBe(0);
    useNodeStore.setState({
      nodes: {
        [ID]: {
          [nid]: { nodeId: nid, longName: '', lastHeardAt: 1_700_000_000, publicKey: pk },
        },
      },
      traceRoutes: {},
      waypoints: {},
      neighborInfo: {},
    });
    const detach = attachMeshcoreIngest(ID);
    packetRouter.dispatch(
      {
        type: 'node_info',
        payload: { nodeId: nid, longName: 'LiveAdvert', lastHeardAt: 1_700_000_100, publicKey: pk },
      },
      ID,
    );
    expect(saveMeshcoreContact).not.toHaveBeenCalled();
    expect(updateAdvert).toHaveBeenCalledWith(nid, 1_700_000_100, null, null, 'LiveAdvert');
    detach();
  });

  it('meshcore_path_updated bumps nodeStore lastHeardAt', () => {
    const pk = new Uint8Array(32);
    pk[0] = 9;
    pk[31] = 2;
    const nodeId = pubkeyToNodeId(pk);
    const oldSec = Math.floor(Date.now() / 1000) - 86_400;
    useNodeStore.setState({
      nodes: {
        [ID]: {
          [nodeId]: { nodeId, longName: 'Peer', lastHeardAt: oldSec, publicKey: pk },
        },
      },
      traceRoutes: {},
      waypoints: {},
      neighborInfo: {},
    });
    const detach = attachMeshcoreIngest(ID);
    packetRouter.dispatch(
      { type: 'meshcore_path_updated', payload: { nodeId, publicKey: pk } },
      ID,
    );
    const node = useNodeStore.getState().nodes[ID][nodeId];
    expect(node.lastHeardAt).toBeGreaterThan(oldSec);
    detach();
  });

  it('does not lump plain channel text under the shared Unknown stub id', () => {
    const msgId = 'ch:0:1700000099';
    upsertMessage(ID, {
      id: msgId,
      from: 0,
      to: 0,
      payload: 'Morning folks! New mesh user here',
      channelIndex: 0,
      timestamp: 1_700_000_000_099,
    });
    meshcoreIngestHandleTextMessage(ID, {
      type: 'text_message',
      payload: {
        id: msgId,
        from: 0,
        to: 0,
        payload: 'Morning folks! New mesh user here',
        channelIndex: 0,
        timestamp: 1_700_000_000_099,
      },
    });
    const row = useMessageStore.getState().messages[ID][msgId];
    expect(row.from).toBe(0);
    expect(row.from).not.toBe(MESHCORE_UNKNOWN_SENDER_STUB_ID);
    expect(saveMeshcoreMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sender_id: null, sender_name: 'Unknown' }),
    );
  });

  it('bumps nodeStore lastHeardAt when a channel message arrives from a known sender', () => {
    const senderId = meshcoreChatStubNodeIdFromDisplayName('WORMT');
    const oldLastHeardSec = Math.floor(Date.now() / 1000) - 172_800;
    const msgTs = Date.now();
    const msgId = `ch:0:${Math.floor(msgTs / 1000)}`;
    useNodeStore.setState({
      nodes: {
        [ID]: {
          [senderId]: {
            nodeId: senderId,
            longName: 'WORMT',
            hwModel: 'Chat',
            lastHeardAt: oldLastHeardSec,
          },
        },
      },
      traceRoutes: {},
      waypoints: {},
      neighborInfo: {},
    });
    upsertMessage(ID, {
      id: msgId,
      from: 0,
      to: 0,
      payload: 'WORMT: Morning mesh',
      channelIndex: 0,
      timestamp: msgTs,
    });
    meshcoreIngestHandleTextMessage(ID, {
      type: 'text_message',
      payload: {
        id: msgId,
        from: 0,
        to: 0,
        payload: 'WORMT: Morning mesh',
        channelIndex: 0,
        timestamp: msgTs,
        hopCount: 3,
      },
    });
    const node = useNodeStore.getState().nodes[ID][senderId];
    expect(node.lastHeardAt).toBeGreaterThan(oldLastHeardSec);
    expect(getNodeStatus(node.lastHeardAt ?? 0)).toBe('online');
  });

  it('relinks channel ingest to named sender when history has same channel+payload', () => {
    const namedId = meshcoreChatStubNodeIdFromDisplayName('Alice');
    const priorId = 'ch:0:1700000000';
    const incomingId = 'ch:0:1700000001';
    useMessageStore.setState({
      messages: {
        [ID]: {
          [priorId]: {
            id: priorId,
            from: namedId,
            senderName: 'Alice',
            to: 0xffffffff,
            payload: 'T',
            channelIndex: 0,
            timestamp: 1_700_000_000_000,
          },
        },
      },
    });
    upsertMessage(ID, {
      id: incomingId,
      from: MESHCORE_UNKNOWN_SENDER_STUB_ID,
      senderName: 'Unknown',
      to: 0xffffffff,
      payload: 'T',
      channelIndex: 0,
      timestamp: 1_700_000_000_001,
    });
    meshcoreIngestHandleTextMessage(ID, {
      type: 'text_message',
      payload: {
        id: incomingId,
        from: 0,
        to: 0,
        payload: 'T',
        channelIndex: 0,
        timestamp: 1_700_000_000_001,
      },
    });
    const row = useMessageStore.getState().messages[ID][incomingId];
    expect(row.from).toBe(namedId);
    expect(row.senderName).toBe('Alice');
    expect(saveMeshcoreMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sender_id: namedId, sender_name: 'Alice', payload: 'T' }),
    );
  });

  it('routes SignedPlain room server posts with roomServerId', () => {
    const roomId = 0xac200e59;
    useNodeStore.setState({
      nodes: {
        [ID]: {
          [roomId]: {
            nodeId: roomId,
            longName: 'TestRoom',
            hwModel: 'Room',
          },
        },
      },
      traceRoutes: {},
      waypoints: {},
      neighborInfo: {},
    });
    const msgId = `room:${roomId}:1700000100`;
    upsertMessage(ID, {
      id: msgId,
      from: roomId,
      to: 0,
      payload: '\0\0\0\0Hi room',
      channelIndex: -2,
      timestamp: 1_700_000_100_000,
      roomServerId: roomId,
    });
    meshcoreIngestHandleTextMessage(ID, {
      type: 'text_message',
      payload: {
        id: msgId,
        from: roomId,
        to: 0,
        payload: '\0\0\0\0Hi room',
        channelIndex: -2,
        timestamp: 1_700_000_100_000,
        txtType: 2,
        roomServerId: roomId,
      },
    });
    const row = useMessageStore.getState().messages[ID][msgId];
    expect(row.roomServerId).toBe(roomId);
    expect(row.channelIndex).toBe(-2);
    expect(row.payload).toBe('Hi room');
    expect(saveMeshcoreMessage).toHaveBeenCalledWith(
      expect.objectContaining({ room_server_id: roomId, channel_idx: -2, payload: 'Hi room' }),
    );
  });

  it('routes PLAIN room server system lines with full body (no author prefix strip)', () => {
    const roomId = 0xac200e59;
    useNodeStore.setState({
      nodes: {
        [ID]: {
          [roomId]: {
            nodeId: roomId,
            longName: 'PizzaParty',
            hwModel: 'Room',
          },
        },
      },
      traceRoutes: {},
      waypoints: {},
      neighborInfo: {},
    });
    const msgId = `${roomId}:1700000300`;
    upsertMessage(ID, {
      id: msgId,
      from: roomId,
      to: 0,
      payload: 'Bot Stats (24h):',
      channelIndex: -1,
      timestamp: 1_700_000_300_000,
    });
    meshcoreIngestHandleTextMessage(ID, {
      type: 'text_message',
      payload: {
        id: msgId,
        from: roomId,
        to: 0,
        payload: 'Bot Stats (24h):',
        channelIndex: -2,
        timestamp: 1_700_000_300_000,
        txtType: 0,
        roomServerId: roomId,
      },
    });
    const row = useMessageStore.getState().messages[ID][msgId];
    expect(row.roomServerId).toBe(roomId);
    expect(row.payload).toBe('Bot Stats (24h):');
    expect(row.channelIndex).toBe(-2);
  });

  it('strips binary author prefix on PLAIN txtType from known room server (official app)', () => {
    const roomId = 0xac200e59;
    const authorPubKey = new Uint8Array(32);
    authorPubKey.set([0x93, 0x6c, 0x73, 0x49], 0);
    const authorId = 0xbeef0001;
    useNodeStore.setState({
      nodes: {
        [ID]: {
          [roomId]: {
            nodeId: roomId,
            longName: 'PizzaParty',
            hwModel: 'Room',
          },
          [authorId]: {
            nodeId: authorId,
            longName: 'OfficialUser',
            hwModel: 'Chat',
            publicKey: authorPubKey,
          },
        },
      },
      traceRoutes: {},
      waypoints: {},
      neighborInfo: {},
    });
    const authorPrefix = String.fromCharCode(0x93, 0x6c, 0x73, 0x49);
    const wire = `${authorPrefix}Test from og app`;
    const msgId = `room:${roomId}:1700000400`;
    upsertMessage(ID, {
      id: msgId,
      from: roomId,
      to: 0,
      payload: wire,
      channelIndex: -2,
      timestamp: 1_700_000_400_000,
      roomServerId: roomId,
    });
    meshcoreIngestHandleTextMessage(ID, {
      type: 'text_message',
      payload: {
        id: msgId,
        from: roomId,
        to: 0,
        payload: wire,
        channelIndex: -2,
        timestamp: 1_700_000_400_000,
        txtType: 0,
        roomServerId: roomId,
      },
    });
    const row = useMessageStore.getState().messages[ID][msgId];
    expect(row.payload).toBe('Test from og app');
    expect(row.senderName).toBe('OfficialUser');
  });

  it('parses SignedPlain room posts when room node is not yet in nodeStore', () => {
    const roomId = 0xdeadbeee;
    const msgId = `room:${roomId}:1700000200`;
    upsertMessage(ID, {
      id: msgId,
      from: roomId,
      to: 0,
      payload: '\0\0\0\0Posted early',
      channelIndex: -2,
      timestamp: 1_700_000_200_000,
      roomServerId: roomId,
    });
    meshcoreIngestHandleTextMessage(ID, {
      type: 'text_message',
      payload: {
        id: msgId,
        from: roomId,
        to: 0,
        payload: '\0\0\0\0Posted early',
        channelIndex: -2,
        timestamp: 1_700_000_200_000,
        txtType: 2,
        roomServerId: roomId,
      },
    });
    const row = useMessageStore.getState().messages[ID][msgId];
    expect(row.payload).toBe('Posted early');
    expect(row.roomServerId).toBe(roomId);
  });

  it('parses inbound tapback wire text into messageStore with emoji + replyTo', () => {
    const parentTs = 1_700_000_000_000;
    const parentId = 'ch:0:1700000000';
    const tapbackId = 'ch:0:1700000001';
    useMessageStore.setState({
      messages: {
        [ID]: {
          [parentId]: {
            id: parentId,
            from: 0x42,
            senderName: 'Alice',
            to: 0xffffffff,
            payload: 'hello',
            channelIndex: 0,
            timestamp: parentTs,
          },
        },
      },
    });

    upsertMessage(ID, {
      id: tapbackId,
      from: 0x99,
      to: 0xffffffff,
      senderName: 'Bob',
      payload: 'Bob: @[Alice] 👍',
      channelIndex: 0,
      timestamp: parentTs + 1000,
    });
    meshcoreIngestHandleTextMessage(ID, {
      type: 'text_message',
      payload: {
        id: tapbackId,
        from: 0x99,
        to: 0,
        payload: 'Bob: @[Alice] 👍',
        channelIndex: 0,
        timestamp: parentTs + 1000,
      },
    });

    const rows = Object.values(useMessageStore.getState().messages[ID] ?? {});
    const tapback = rows.find((r) => r.tapback);
    expect(tapback).toBeDefined();
    expect(tapback!.payload).toBe('👍');
    expect(tapback!.replyTo).toBe(String(parentTs));
    expect(saveMeshcoreMessage).toHaveBeenCalledWith(
      expect.objectContaining({ payload: '👍', emoji: expect.any(Number), reply_id: parentTs }),
    );
  });

  it('parses keyed inbound tapback wire into messageStore with emoji + replyTo', () => {
    const parentTs = 1_700_000_000_000;
    const parentId = 'ch:0:1700000000';
    const tapbackId = 'ch:0:1700000001';
    useMessageStore.setState({
      messages: {
        [ID]: {
          [parentId]: {
            id: parentId,
            from: 0x42,
            senderName: 'Alice',
            to: 0xffffffff,
            payload: 'hello',
            channelIndex: 0,
            timestamp: parentTs,
          },
        },
      },
    });

    const wire = `Bob: @[Alice#${parentTs}] 👍`;
    upsertMessage(ID, {
      id: tapbackId,
      from: 0x99,
      to: 0xffffffff,
      senderName: 'Bob',
      payload: wire,
      channelIndex: 0,
      timestamp: parentTs + 1000,
    });
    meshcoreIngestHandleTextMessage(ID, {
      type: 'text_message',
      payload: {
        id: tapbackId,
        from: 0x99,
        to: 0,
        payload: wire,
        channelIndex: 0,
        timestamp: parentTs + 1000,
      },
    });

    const rows = Object.values(useMessageStore.getState().messages[ID] ?? {});
    const tapback = rows.find((r) => r.tapback);
    expect(tapback).toBeDefined();
    expect(tapback!.payload).toBe('👍');
    expect(tapback!.replyTo).toBe(String(parentTs));
  });

  it('does not create a contacts-list stub for unresolved RF DMs (from=0)', () => {
    const botId = 0xac200e59;
    const msgId = `${botId}:1700000300`;
    upsertMessage(ID, {
      id: msgId,
      from: 0,
      senderName: 'Unknown',
      to: 0,
      payload: 'weather report',
      channelIndex: -1,
      timestamp: 1_700_000_000_300,
    });
    meshcoreIngestHandleTextMessage(ID, {
      type: 'text_message',
      payload: {
        id: msgId,
        from: 0,
        to: 0,
        payload: 'weather report',
        channelIndex: -1,
        timestamp: 1_700_000_000_300,
      },
    });
    // Identity bucket may be absent when no nodes were upserted for this identity.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- store bucket optional at runtime
    expect(useNodeStore.getState().nodes[ID]?.[botId]).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- store bucket optional at runtime
    expect(useNodeStore.getState().nodes[ID]?.[MESHCORE_UNKNOWN_SENDER_STUB_ID]).toBeUndefined();
  });
});

describe('meshcoreIngest hop correlation (driver path)', () => {
  const saveMeshcoreMessage = vi.fn().mockResolvedValue(undefined);
  const now = Date.now();
  const channelMsgId = `ch:0:${Math.floor(now / 1000)}`;
  const dmMsgId = 'dm:abc:1700000001';

  beforeEach(() => {
    vi.spyOn(window.electronAPI.db, 'saveMeshcoreMessage').mockImplementation(saveMeshcoreMessage);
    saveMeshcoreMessage.mockClear();
    useMessageStore.setState({ messages: {} });
    addIdentity({
      id: ID,
      protocol: meshcoreProtocol,
      signature: 'meshcore:hop-ingest-test',
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
  });

  afterEach(() => {
    useMessageStore.setState({ messages: {} });
    vi.restoreAllMocks();
  });

  function dispatchChannelText(overrides: { hopCount?: number; payload?: string } = {}) {
    const payload = overrides.payload ?? 'Peer: hello mesh';
    upsertMessage(ID, {
      id: channelMsgId,
      from: 0,
      to: 0xffffffff,
      payload,
      channelIndex: 0,
      timestamp: now,
      receivedVia: 'rf',
    });
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: channelMsgId,
          from: 0,
          to: 0,
          payload,
          channelIndex: 0,
          timestamp: now,
          hopCount: overrides.hopCount,
        },
      },
      ID,
    );
  }

  it('correlates channel rxHops from GRP_TXT raw packet log when hopCount omitted', () => {
    const detach = attachMeshcoreIngest(ID, {
      rawPacketsForHopCorrelation: () => [
        { ts: now - 50, payloadTypeString: 'GRP_TXT', fromNodeId: null, hopCount: 2 },
      ],
    });
    dispatchChannelText();
    detach();
    const record = useMessageStore.getState().messages[ID][channelMsgId];
    expect(record).toBeDefined();
    expect(messageRecordToChatMessage(record).rxHops).toBe(2);
  });

  it('correlates DM rxHops from TXT_MSG raw packet log when hopCount omitted', () => {
    const detach = attachMeshcoreIngest(ID, {
      rawPacketsForHopCorrelation: () => [
        { ts: now - 50, payloadTypeString: 'TXT_MSG', fromNodeId: 0xabcd, hopCount: 1 },
      ],
    });
    upsertMessage(ID, {
      id: dmMsgId,
      from: 0xabcd,
      senderName: 'Peer',
      to: 0xffffffff,
      payload: 'dm hello',
      channelIndex: -1,
      timestamp: now,
      receivedVia: 'rf',
    });
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: dmMsgId,
          from: 0xabcd,
          to: 0,
          payload: 'dm hello',
          channelIndex: -1,
          timestamp: now,
        },
      },
      ID,
    );
    detach();
    const record = useMessageStore.getState().messages[ID][dmMsgId];
    expect(record).toBeDefined();
    expect(messageRecordToChatMessage(record).rxHops).toBe(1);
  });

  it('prefers event.payload.hopCount over raw packet correlation', () => {
    const detach = attachMeshcoreIngest(ID, {
      rawPacketsForHopCorrelation: () => [
        { ts: now - 50, payloadTypeString: 'GRP_TXT', fromNodeId: null, hopCount: 2 },
      ],
    });
    dispatchChannelText({ hopCount: 4 });
    detach();
    const record = useMessageStore.getState().messages[ID][channelMsgId];
    expect(record).toBeDefined();
    expect(messageRecordToChatMessage(record).rxHops).toBe(4);
  });

  it('correlates hops when rawPackets callback returns a fresh same-tick packet list', () => {
    const packets = [
      { ts: now - 10, payloadTypeString: 'GRP_TXT' as const, fromNodeId: null, hopCount: 5 },
    ];
    const detach = attachMeshcoreIngest(ID, {
      rawPacketsForHopCorrelation: () => packets,
    });
    dispatchChannelText();
    detach();
    const record = useMessageStore.getState().messages[ID][channelMsgId];
    expect(record).toBeDefined();
    expect(messageRecordToChatMessage(record).rxHops).toBe(5);
  });

  it('leaves rxHops undefined without correlation callback', () => {
    const detach = attachMeshcoreIngest(ID);
    dispatchChannelText();
    detach();
    const record = useMessageStore.getState().messages[ID][channelMsgId];
    expect(record).toBeDefined();
    expect(messageRecordToChatMessage(record).rxHops).toBeUndefined();
  });
});
