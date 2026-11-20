import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeshcoreMessageDbRow } from '../../hooks/meshcore/meshcoreHookPreamble';
import {
  mapMeshcoreDbRowsToChatMessages,
  messageToDbRow,
} from '../../hooks/meshcore/meshcoreHookPreamble';
import { setConnection, useConnectionStore } from '../../stores/connectionStore';
import { addIdentity } from '../../stores/identityStore';
import {
  upsertMessage,
  upsertMessageRecordsForIdentity,
  useMessageStore,
} from '../../stores/messageStore';
import { useNodeStore } from '../../stores/nodeStore';
import {
  getTakChannels,
  setTakChannels,
  setTakRadio,
  useTakChannelStore,
} from '../../stores/takChannelStore';
import { useTakRelayPrefsStore } from '../../stores/takRelayPrefsStore';
import { setTakSinkActive } from '../../stores/takSinkStore';
import { clearTakTrackerFixes, useTakTrackerStore } from '../../stores/takTrackerStore';
import { packetRouter } from '../drivers/PacketRouter';
import {
  hydrateMeshcoreMessagesFromDb,
  meshcoreHydratedMessageRecords,
} from '../hydrateIdentityStoresFromDb';
import {
  clearMeshcorePubKeyRegistry,
  registerMeshcorePubKey,
} from '../meshcore/meshcorePubKeyRegistry';
import { MESHCORE_TXT_TYPE_SIGNED_PLAIN } from '../meshcoreChannelText';
import { repairMeshcoreHydratedMessages } from '../meshcoreDbCacheHydration';
import { decodeMeshcoreDirectMessageEvents } from '../meshcoreDirectMessageDecode';
import { clearMeshcoreDedupeIndex } from '../meshcoreMessageDedupeIndex';
import { upsertMeshcoreMessageWithDedup } from '../meshcoreStoreDedup';
import {
  MESHCORE_UNKNOWN_SENDER_STUB_ID,
  meshcoreChatStubNodeIdFromDisplayName,
  pubKeyPrefixHex,
  pubkeyToNodeId,
} from '../meshcoreUtils';
import { getNodeStatus } from '../nodeStatus';
import { meshcoreProtocol } from '../protocols/MeshCoreProtocol';
import { loadRuntimeSource } from '../sourceContractTestHelpers';
import { messageRecordToChatMessage } from '../storeRecordAdapters';
import { resetTakRelayedChannelLines } from '../tak/takChannelRelay';
import { resetTakRelayedDirectMessages } from '../tak/takDirectMessages';
import { rememberTakSend, resetTakEchoForTests } from '../tak/takEchoGuard';
import {
  attachMeshcoreIngest,
  meshcoreIngestHandleTextMessage,
  relayInsertedMeshcoreMqttChannel,
} from './meshcoreIngest';

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

  describe('room posts dispatched through PacketRouter', () => {
    const roomId = 0x52f00d11;
    const roomPubKey = Uint8Array.from({ length: 32 }, (_, i) => 0x90 + i);
    const knownAuthorId = 0x41424344;
    const myNodeNum = 0x6d650001;
    const postSec = 1_700_000_500;
    const ACCENTED_E = String.fromCodePoint(0xc9);
    const CYRILLIC_WORD = String.fromCodePoint(0x41f, 0x440, 0x438, 0x432, 0x435, 0x442);
    const WAVE = String.fromCodePoint(0x1f44b);
    // A PLAIN line the room server writes itself is the room's own post: the room is its sender,
    // under its full name (not PacketRouter's 7-character short name).
    const PLAIN_SYSTEM_LINE_ROW = {
      sender_id: roomId,
      sender_name: 'Test Room',
      payload: 'Bot Stats (24h):',
    };

    afterEach(() => {
      clearMeshcorePubKeyRegistry();
      clearMeshcoreDedupeIndex(ID);
      useConnectionStore.setState({ connections: {} });
    });

    function pubKeyStartingWith(first4: readonly number[]): Uint8Array {
      const key = new Uint8Array(32);
      key.set(first4, 0);
      return key;
    }

    // A contact the app knows: in the node store (read by meshcoreIngest) and in the public key
    // registry (read by the decoder to find a room post's author).
    function addContact(nodeId: number, longName: string, publicKey: Uint8Array): void {
      registerMeshcorePubKey(nodeId, publicKey);
      useNodeStore.setState((s) => ({
        nodes: {
          ...s.nodes,
          [ID]: {
            ...s.nodes[ID],
            [nodeId]: { nodeId, longName, hwModel: 'Chat', publicKey },
          },
        },
      }));
    }

    function seedRoomAndKnownAuthor(): void {
      clearMeshcorePubKeyRegistry();
      registerMeshcorePubKey(roomId, roomPubKey);
      useNodeStore.setState({
        nodes: {
          [ID]: {
            [roomId]: {
              nodeId: roomId,
              longName: 'Test Room',
              hwModel: 'Room',
              publicKey: roomPubKey,
            },
          },
        },
        traceRoutes: {},
        waypoints: {},
        neighborInfo: {},
      });
      addContact(knownAuthorId, 'Bob Ascii', pubKeyStartingWith([0x41, 0x42, 0x43, 0x44]));
    }

    function addMe(): void {
      addContact(myNodeNum, 'Me Node', pubKeyStartingWith([0x6d, 0x65, 0x6d, 0x65]));
      setConnection(ID, { myNodeNum, status: 'connected' });
    }

    // The event the app builds for a room post (`decodeMeshcoreDirectMessageEvents`, used by the
    // protocol subscriber and the waiting-queue drain alike), sent through PacketRouter, so the
    // post gets the id the app gives it. Returns that id.
    function deliverRoomPost(
      wire: string,
      txtType: number = MESHCORE_TXT_TYPE_SIGNED_PLAIN,
    ): string {
      const events = decodeMeshcoreDirectMessageEvents(
        { pubKeyPrefix: roomPubKey.slice(0, 6), text: wire, senderTimestamp: postSec, txtType },
        new Map([[pubKeyPrefixHex(roomPubKey), roomId]]),
        new Set([roomId]),
      );
      let id = '';
      for (const event of events) {
        if (event.type === 'text_message') id = event.payload.id;
        packetRouter.dispatch(event, ID);
      }
      expect(id).not.toBe('');
      return id;
    }

    function sendingOwnPost(text: string): void {
      upsertMeshcoreMessageWithDedup(ID, {
        sender_id: myNodeNum,
        sender_name: 'Me Node',
        payload: text,
        meshcoreDedupeKey: text,
        channel: -2,
        timestamp: postSec * 1000,
        status: 'sending',
        roomServerId: roomId,
        to: roomId,
      });
    }

    function roomRows(): { sender_id: number; sender_name: string; payload: string }[] {
      return Object.values(useMessageStore.getState().messages[ID])
        .filter((r) => r.roomServerId === roomId)
        .map((r) => {
          const m = messageRecordToChatMessage(r);
          return { sender_id: m.sender_id, sender_name: m.sender_name, payload: m.payload };
        });
    }

    function savedRoomRows(): { sender_id: unknown; sender_name: unknown; payload: unknown }[] {
      return saveMeshcoreMessage.mock.calls
        .map((call) => call[0] as Record<string, unknown>)
        .filter((row) => row.room_server_id === roomId)
        .map((row) => ({
          sender_id: row.sender_id,
          sender_name: row.sender_name,
          payload: row.payload,
        }));
    }

    // What a restart does: the store and the dedupe index start empty, and the saved rows are
    // read back the way the runtime does at launch (`reloadMeshcoreNodesFromDb`: map, repair,
    // `meshcoreHydratedMessageRecords`).
    function restartFromSavedRows(): void {
      const rows = saveMeshcoreMessage.mock.calls.map(
        (call, index) => ({ ...(call[0] as object), id: index + 1 }) as MeshcoreMessageDbRow,
      );
      useMessageStore.setState({ messages: {} });
      clearMeshcoreDedupeIndex(ID);
      const { connections } = useConnectionStore.getState();
      const mapped = repairMeshcoreHydratedMessages(
        mapMeshcoreDbRowsToChatMessages(rows),
        new Set([roomId]),
        ID in connections ? connections[ID].myNodeNum : undefined,
      );
      upsertMessageRecordsForIdentity(ID, meshcoreHydratedMessageRecords(mapped, rows));
    }

    it('labels a live post by an unknown author Unknown, not with the room name', () => {
      seedRoomAndKnownAuthor();
      const detach = attachMeshcoreIngest(ID);
      deliverRoomPost('zyxwhello from a stranger');
      detach();
      expect(roomRows()).toEqual([
        { sender_id: 0, sender_name: 'Unknown', payload: 'hello from a stranger' },
      ]);
    });

    it('keeps Unknown when the same unknown-author post is delivered twice', () => {
      seedRoomAndKnownAuthor();
      const detach = attachMeshcoreIngest(ID);
      deliverRoomPost('zyxwhello from a stranger');
      deliverRoomPost('zyxwhello from a stranger');
      detach();
      expect(roomRows()).toEqual([
        { sender_id: 0, sender_name: 'Unknown', payload: 'hello from a stranger' },
      ]);
    });

    it('leaves the author and body of a stored room post alone when the router sees it again', () => {
      seedRoomAndKnownAuthor();
      const detach = attachMeshcoreIngest(ID);
      const id = deliverRoomPost('zyxwhello from a stranger');
      detach();
      expect(deliverRoomPost('zyxwhello from a stranger')).toBe(id);
      const row = useMessageStore.getState().messages[ID][id];
      expect({ from: row.from, senderName: row.senderName, payload: row.payload }).toEqual({
        from: 0,
        senderName: 'Unknown',
        payload: 'hello from a stranger',
      });
    });

    it('keeps the contact name on a live post by a known author', () => {
      seedRoomAndKnownAuthor();
      const detach = attachMeshcoreIngest(ID);
      deliverRoomPost('ABCDhello from bob');
      detach();
      expect(roomRows()).toEqual([
        { sender_id: knownAuthorId, sender_name: 'Bob Ascii', payload: 'hello from bob' },
      ]);
    });

    it('keeps the contact name when a known-author post is delivered twice', () => {
      seedRoomAndKnownAuthor();
      const detach = attachMeshcoreIngest(ID);
      deliverRoomPost('ABCDhello from bob');
      deliverRoomPost('ABCDhello from bob');
      detach();
      expect(roomRows()).toEqual([
        { sender_id: knownAuthorId, sender_name: 'Bob Ascii', payload: 'hello from bob' },
      ]);
    });

    it('names an Unknown post once the author contact is known and the post comes again', () => {
      seedRoomAndKnownAuthor();
      const detach = attachMeshcoreIngest(ID);
      const lateAuthorId = 0x7a797877;
      const unknownId = deliverRoomPost('zyxwhello from a stranger');
      addContact(lateAuthorId, 'Zed Late', pubKeyStartingWith([0x7a, 0x79, 0x78, 0x77]));
      // Once the prefix resolves, the decoder gives the post an id that carries the author.
      expect(deliverRoomPost('zyxwhello from a stranger')).not.toBe(unknownId);
      detach();
      expect(roomRows()).toEqual([
        { sender_id: lateAuthorId, sender_name: 'Zed Late', payload: 'hello from a stranger' },
      ]);
    });

    it('keeps the local node as the author of its own post echoed by the room', () => {
      seedRoomAndKnownAuthor();
      addMe();
      sendingOwnPost('my own post');
      const detach = attachMeshcoreIngest(ID);
      deliverRoomPost('mememy own post');
      deliverRoomPost('mememy own post');
      detach();
      expect(roomRows()).toEqual([
        { sender_id: myNodeNum, sender_name: 'Me Node', payload: 'my own post' },
      ]);
    });

    it('keeps Unknown when a post whose wire text ends in padding is delivered twice', () => {
      seedRoomAndKnownAuthor();
      const detach = attachMeshcoreIngest(ID);
      const wire = 'zyxwhello padded' + String.fromCharCode(0x7f);
      deliverRoomPost(wire);
      deliverRoomPost(wire);
      detach();
      expect(roomRows()).toEqual([
        { sender_id: 0, sender_name: 'Unknown', payload: 'hello padded' },
      ]);
    });

    it('keeps two different posts by an unknown author in one second as two rows', () => {
      seedRoomAndKnownAuthor();
      const detach = attachMeshcoreIngest(ID);
      deliverRoomPost('zyxwfirst from a stranger');
      deliverRoomPost('zyxwsecond from a stranger');
      detach();
      expect({ rows: roomRows(), saved: savedRoomRows() }).toEqual({
        rows: [
          { sender_id: 0, sender_name: 'Unknown', payload: 'first from a stranger' },
          { sender_id: 0, sender_name: 'Unknown', payload: 'second from a stranger' },
        ],
        saved: [
          { sender_id: null, sender_name: 'Unknown', payload: 'first from a stranger' },
          { sender_id: null, sender_name: 'Unknown', payload: 'second from a stranger' },
        ],
      });
    });

    it('keeps two different posts by a known author in one second as two rows', () => {
      seedRoomAndKnownAuthor();
      const detach = attachMeshcoreIngest(ID);
      deliverRoomPost('ABCDfirst from bob');
      deliverRoomPost('ABCDsecond from bob');
      detach();
      expect({ rows: roomRows(), saved: savedRoomRows() }).toEqual({
        rows: [
          { sender_id: knownAuthorId, sender_name: 'Bob Ascii', payload: 'first from bob' },
          { sender_id: knownAuthorId, sender_name: 'Bob Ascii', payload: 'second from bob' },
        ],
        saved: [
          { sender_id: knownAuthorId, sender_name: 'Bob Ascii', payload: 'first from bob' },
          { sender_id: knownAuthorId, sender_name: 'Bob Ascii', payload: 'second from bob' },
        ],
      });
    });

    it('keeps two own posts sent in one second as two sent rows once the room echoes both', () => {
      seedRoomAndKnownAuthor();
      addMe();
      sendingOwnPost('first own post');
      sendingOwnPost('second own post');
      const detach = attachMeshcoreIngest(ID);
      deliverRoomPost('memefirst own post');
      deliverRoomPost('memesecond own post');
      detach();
      const rows = Object.values(useMessageStore.getState().messages[ID])
        .filter((r) => r.roomServerId === roomId)
        .map((r) => ({ payload: r.payload, status: r.status }));
      expect(rows).toEqual([
        { payload: 'first own post', status: 'acked' },
        { payload: 'second own post', status: 'acked' },
      ]);
    });

    it.each([
      [
        'an unknown author',
        'zyxwhello from a stranger',
        { sender_id: 0, sender_name: 'Unknown', payload: 'hello from a stranger' },
      ],
      [
        'a known author',
        'ABCDhello from bob',
        { sender_id: knownAuthorId, sender_name: 'Bob Ascii', payload: 'hello from bob' },
      ],
      [
        'a wire ending in padding',
        'zyxwhello padded' + String.fromCharCode(0x7f),
        { sender_id: 0, sender_name: 'Unknown', payload: 'hello padded' },
      ],
      [
        'a known author whose body starts with an emoji',
        'ABCD' + WAVE + ' hi there',
        { sender_id: knownAuthorId, sender_name: 'Bob Ascii', payload: WAVE + ' hi there' },
      ],
      [
        'a known author whose body reads like Name: text',
        'ABCDFieldteam: we are here',
        { sender_id: knownAuthorId, sender_name: 'Bob Ascii', payload: 'Fieldteam: we are here' },
      ],
      [
        'an unknown author whose body starts with a mention',
        'zyxw@[Bob Ascii] thanks',
        { sender_id: 0, sender_name: 'Unknown', payload: '@[Bob Ascii] thanks' },
      ],
      [
        'a known author whose body starts with an accented letter',
        'ABCD' + ACCENTED_E + 'quipe ready',
        { sender_id: knownAuthorId, sender_name: 'Bob Ascii', payload: ACCENTED_E + 'quipe ready' },
      ],
      [
        'an unknown author whose body starts with an accented letter',
        'zyxw' + ACCENTED_E + 'quipe ready',
        { sender_id: 0, sender_name: 'Unknown', payload: ACCENTED_E + 'quipe ready' },
      ],
      [
        'a known author whose body is Cyrillic',
        'ABCD' + CYRILLIC_WORD + ' all',
        { sender_id: knownAuthorId, sender_name: 'Bob Ascii', payload: CYRILLIC_WORD + ' all' },
      ],
    ])('merges a resent post by %s into its row after a restart', (_label, wire, row) => {
      seedRoomAndKnownAuthor();
      let detach = attachMeshcoreIngest(ID);
      deliverRoomPost(wire);
      detach();
      restartFromSavedRows();
      const reloaded = roomRows();
      detach = attachMeshcoreIngest(ID);
      deliverRoomPost(wire);
      detach();
      expect({ reloaded, rows: roomRows(), saves: saveMeshcoreMessage.mock.calls.length }).toEqual({
        reloaded: [row],
        rows: [row],
        saves: 1,
      });
    });

    // Reload shows this post differently from the live copy, which predates this change: an
    // unknown author's `Name: text` reads as a post by that name (`meshcoreDbMessageDisplay`).
    // The reloaded row still has the live post's id, so when the room resends the post the live
    // copy replaces it instead of adding a second row.
    const NAME_TEXT_WIRE = 'zyxwFieldteam: we are here';
    const NAME_TEXT_ROW = {
      sender_id: 0,
      sender_name: 'Unknown',
      payload: 'Fieldteam: we are here',
    };

    it('keeps one row when the room resends a post that reload shows differently', () => {
      seedRoomAndKnownAuthor();
      let detach = attachMeshcoreIngest(ID);
      deliverRoomPost(NAME_TEXT_WIRE);
      detach();
      restartFromSavedRows();
      const reloaded = roomRows();
      detach = attachMeshcoreIngest(ID);
      deliverRoomPost(NAME_TEXT_WIRE);
      detach();
      expect({ reloaded, rows: roomRows() }).toEqual({
        reloaded: [
          {
            sender_id: meshcoreChatStubNodeIdFromDisplayName('Fieldteam'),
            sender_name: 'Fieldteam',
            payload: 'we are here',
          },
        ],
        rows: [NAME_TEXT_ROW],
      });
    });

    it('keeps one row when the room resends a post after the post-prune reload', async () => {
      seedRoomAndKnownAuthor();
      const wire = NAME_TEXT_WIRE;
      let detach = attachMeshcoreIngest(ID);
      deliverRoomPost(wire);
      detach();
      const rows = saveMeshcoreMessage.mock.calls.map((call, index) => ({
        ...(call[0] as object),
        id: index + 1,
      }));
      vi.spyOn(window.electronAPI.db, 'getMeshcoreIdentityHydration').mockResolvedValue({
        contacts: [],
        nodes: [],
        hopHistory: [],
        messages: rows,
      });
      useMessageStore.setState({ messages: {} });
      clearMeshcoreDedupeIndex(ID);
      await hydrateMeshcoreMessagesFromDb(ID, 'upsert');
      const reloaded = roomRows().map((r) => r.payload);
      detach = attachMeshcoreIngest(ID);
      deliverRoomPost(wire);
      detach();
      expect({ reloaded, rows: roomRows() }).toEqual({
        reloaded: ['we are here'],
        rows: [NAME_TEXT_ROW],
      });
    });

    it('merges the room echo of an own post into its row after a restart', () => {
      seedRoomAndKnownAuthor();
      addMe();
      void window.electronAPI.db.saveMeshcoreMessage(
        messageToDbRow(
          {
            sender_id: myNodeNum,
            sender_name: 'Me Node',
            payload: 'my own post',
            channel: -2,
            timestamp: postSec * 1000,
            status: 'acked',
            roomServerId: roomId,
            to: roomId,
          },
          myNodeNum,
        ),
      );
      restartFromSavedRows();
      const reloaded = roomRows();
      const detach = attachMeshcoreIngest(ID);
      deliverRoomPost('mememy own post');
      detach();
      const own = { sender_id: myNodeNum, sender_name: 'Me Node', payload: 'my own post' };
      expect({ reloaded, rows: roomRows() }).toEqual({ reloaded: [own], rows: [own] });
    });

    it('keeps both posts from one second after a restart and adds no row when they come again', () => {
      seedRoomAndKnownAuthor();
      let detach = attachMeshcoreIngest(ID);
      deliverRoomPost('zyxwfirst from a stranger');
      deliverRoomPost('zyxwsecond from a stranger');
      detach();
      restartFromSavedRows();
      detach = attachMeshcoreIngest(ID);
      deliverRoomPost('zyxwfirst from a stranger');
      deliverRoomPost('zyxwsecond from a stranger');
      detach();
      expect({ rows: roomRows(), saves: saveMeshcoreMessage.mock.calls.length }).toEqual({
        rows: [
          { sender_id: 0, sender_name: 'Unknown', payload: 'first from a stranger' },
          { sender_id: 0, sender_name: 'Unknown', payload: 'second from a stranger' },
        ],
        saves: 2,
      });
    });

    // PacketRouter writes each line's raw copy before meshcoreIngest runs; that copy is the line
    // itself, not an earlier post, so the ingest still stores and saves the line.
    it('saves a PLAIN system line from the room server once, also when it comes twice', () => {
      seedRoomAndKnownAuthor();
      const detach = attachMeshcoreIngest(ID);
      deliverRoomPost('Bot Stats (24h):', 0);
      const once = roomRows();
      deliverRoomPost('Bot Stats (24h):', 0);
      detach();
      expect({ once, rows: roomRows(), saved: savedRoomRows() }).toEqual({
        once: [PLAIN_SYSTEM_LINE_ROW],
        rows: [PLAIN_SYSTEM_LINE_ROW],
        saved: [PLAIN_SYSTEM_LINE_ROW],
      });
    });

    it('keeps and saves two different PLAIN lines from the room server in one second', () => {
      seedRoomAndKnownAuthor();
      const detach = attachMeshcoreIngest(ID);
      deliverRoomPost('Bot Stats (24h):', 0);
      deliverRoomPost('Uptime: 3d', 0);
      detach();
      const uptime = { sender_id: roomId, sender_name: 'Test Room', payload: 'Uptime: 3d' };
      expect({ rows: roomRows(), saved: savedRoomRows() }).toEqual({
        rows: [PLAIN_SYSTEM_LINE_ROW, uptime],
        saved: [PLAIN_SYSTEM_LINE_ROW, uptime],
      });
    });

    it('keeps a PLAIN system line after a restart and does not save it again when resent', () => {
      seedRoomAndKnownAuthor();
      let detach = attachMeshcoreIngest(ID);
      deliverRoomPost('Bot Stats (24h):', 0);
      detach();
      restartFromSavedRows();
      const reloaded = roomRows();
      detach = attachMeshcoreIngest(ID);
      deliverRoomPost('Bot Stats (24h):', 0);
      detach();
      expect({ reloaded, rows: roomRows(), saves: saveMeshcoreMessage.mock.calls.length }).toEqual({
        reloaded: [PLAIN_SYSTEM_LINE_ROW],
        rows: [PLAIN_SYSTEM_LINE_ROW],
        saves: 1,
      });
    });

    it('does not take a SignedPlain post with no body for a line by the room', () => {
      seedRoomAndKnownAuthor();
      const detach = attachMeshcoreIngest(ID);
      deliverRoomPost('zyxw');
      detach();
      expect(roomRows()).toEqual([{ sender_id: 0, sender_name: 'Unknown', payload: 'zyxw' }]);
    });

    it('saves a PLAIN line in Cyrillic from the room server whole', () => {
      seedRoomAndKnownAuthor();
      const detach = attachMeshcoreIngest(ID);
      deliverRoomPost(CYRILLIC_WORD + ' all', 0);
      detach();
      const row = { sender_id: roomId, sender_name: 'Test Room', payload: CYRILLIC_WORD + ' all' };
      expect({ rows: roomRows(), saved: savedRoomRows() }).toEqual({ rows: [row], saved: [row] });
    });
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

  function dispatchChannelText(
    overrides: { hopCount?: number; payload?: string; rxSnr?: number; rxRssi?: number } = {},
  ) {
    const payload = overrides.payload ?? 'Peer: hello mesh';
    upsertMessage(ID, {
      id: channelMsgId,
      from: 0,
      to: 0xffffffff,
      payload,
      channelIndex: 0,
      timestamp: now,
      receivedVia: 'rf',
      rxSnr: overrides.rxSnr,
      rxRssi: overrides.rxRssi,
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
          rxSnr: overrides.rxSnr,
          rxRssi: overrides.rxRssi,
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

  it('correlates channel path hash size from GRP_TXT raw packet when omitted on event', () => {
    const detach = attachMeshcoreIngest(ID, {
      rawPacketsForHopCorrelation: () => [
        {
          ts: now - 50,
          payloadTypeString: 'GRP_TXT',
          fromNodeId: null,
          hopCount: 2,
          pathHashSizeBytes: 3,
        },
      ],
    });
    dispatchChannelText();
    detach();
    const record = useMessageStore.getState().messages[ID][channelMsgId];
    expect(messageRecordToChatMessage(record).rxPathHashSizeBytes).toBe(3);
  });

  it('keeps event pathHashSizeBytes on channel ingest', () => {
    const detach = attachMeshcoreIngest(ID);
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: channelMsgId,
          from: 0,
          to: 0,
          payload: 'Alice: hello',
          channelIndex: 0,
          timestamp: now,
          hopCount: 1,
          pathHashSizeBytes: 2,
        },
      },
      ID,
    );
    detach();
    const record = useMessageStore.getState().messages[ID][channelMsgId];
    expect(messageRecordToChatMessage(record)).toMatchObject({
      rxHops: 1,
      rxPathHashSizeBytes: 2,
    });
  });

  it('preserves per-message signal measurements when normalizing MeshCore channel text', () => {
    const detach = attachMeshcoreIngest(ID);
    dispatchChannelText({ rxSnr: 0, rxRssi: -98, hopCount: 2 });
    detach();
    const record = useMessageStore.getState().messages[ID][channelMsgId];
    expect(messageRecordToChatMessage(record)).toMatchObject({ rxSnr: 0, rxRssi: -98, rxHops: 2 });
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

/** Serve one channel of a radio to TAK, as the TAK panel does. */
function serveTakChannel(identityId: string, index: number, key: string): void {
  setTakChannels(identityId, [
    ...getTakChannels(identityId),
    { protocol: 'meshcore', index, key, name: `Ch ${index}`, atakName: `#Ch ${index}` },
  ]);
  useTakRelayPrefsStore.getState().setChannelMode(identityId, 'selected');
  useTakRelayPrefsStore.getState().setChatChannel(identityId, key, true);
}

describe('meshcore ingest TAK channel relay', () => {
  const TAK_ID = 'meshcore-ingest-tak-test';
  const pushChatMessage = vi.fn().mockResolvedValue(undefined);
  let seq = 0;

  function channelMessage(payload: string, channelIndex = 3) {
    seq += 1;
    const id = `ch:${channelIndex}:${1_700_000_000 + seq}`;
    const timestamp = (1_700_000_000 + seq) * 1000;
    upsertMessage(TAK_ID, { id, from: 0, to: 0, payload, channelIndex, timestamp });
    meshcoreIngestHandleTextMessage(TAK_ID, {
      type: 'text_message',
      payload: { id, from: 0, to: 0, payload, channelIndex, timestamp },
    });
  }

  const FIX = 'Rex: !MT1;u=A1B2C3D4;k=k9;la=39.7;ln=-105.1;q=7';

  beforeEach(() => {
    vi.spyOn(window.electronAPI.db, 'saveMeshcoreMessage').mockResolvedValue(undefined);
    vi.spyOn(window.electronAPI.tak, 'pushChatMessage').mockImplementation(pushChatMessage);
    pushChatMessage.mockClear();
    useMessageStore.setState({ messages: {} });
    useTakRelayPrefsStore.setState({ byIdentity: {} });
    useTakChannelStore.setState({ channelsByIdentity: {} });
    clearTakTrackerFixes();
    resetTakRelayedChannelLines();
    setTakSinkActive(true);
  });

  afterEach(() => {
    setTakSinkActive(false);
    useTakRelayPrefsStore.setState({ byIdentity: {} });
    useTakChannelStore.setState({ channelsByIdentity: {} });
    clearTakTrackerFixes();
    vi.restoreAllMocks();
  });

  it('records a tracker fix heard on an enabled tracker channel', () => {
    useTakRelayPrefsStore.getState().setTrackerChannel(TAK_ID, 3, true);
    channelMessage(FIX);
    const entry = useTakTrackerStore.getState().fixes.a1b2c3d4;
    expect(entry.fix).toMatchObject({ callsign: 'Rex', role: 'k9', lat: 39.7, lon: -105.1 });
    expect(pushChatMessage).not.toHaveBeenCalled();
  });

  it('ignores tracker fixes on channels that are not enabled', () => {
    useTakRelayPrefsStore.getState().setTrackerChannel(TAK_ID, 1, true);
    channelMessage(FIX);
    expect(useTakTrackerStore.getState().fixes).toEqual({});
  });

  it('does nothing without an active TAK sink', () => {
    setTakSinkActive(false);
    useTakRelayPrefsStore.getState().setTrackerChannel(TAK_ID, 3, true);
    serveTakChannel(TAK_ID, 3, '0123456789abcdef');
    channelMessage(FIX);
    channelMessage('Bob: hello');
    expect(useTakTrackerStore.getState().fixes).toEqual({});
    expect(pushChatMessage).not.toHaveBeenCalled();
  });

  it('hands messages on a served channel to TAK clients once', () => {
    serveTakChannel(TAK_ID, 3, '0123456789abcdef');
    channelMessage('Bob: on scene');
    expect(pushChatMessage).toHaveBeenCalledTimes(1);
    expect(pushChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelKey: '0123456789abcdef',
        senderCallsign: 'Bob',
        text: 'on scene',
      }),
    );
  });

  it.each([
    ['a reaction', 'Bob: @[Alice] 👍'],
    ['a keyed reaction', 'Bob: @[Alice#1700000900000] 👍'],
    ['a reply', 'Bob: @[Alice] copy that'],
  ])('hands %s to TAK clients once when the radio delivers it twice', (_label, wire) => {
    serveTakChannel(TAK_ID, 3, '0123456789abcdef');
    /** One delivery from the companion: its event id is the channel, send time and text. */
    const deliver = (text: string, sec: number) => {
      const id = `ch:3:${sec}:${text}`;
      const timestamp = sec * 1000;
      upsertMessage(TAK_ID, { id, from: 0, to: 0, payload: text, channelIndex: 3, timestamp });
      meshcoreIngestHandleTextMessage(TAK_ID, {
        type: 'text_message',
        payload: { id, from: 0, to: 0, payload: text, channelIndex: 3, timestamp },
      });
    };
    deliver('Alice: hello', 1_700_000_900);
    pushChatMessage.mockClear();
    deliver(wire, 1_700_000_960);
    deliver(wire, 1_700_000_960);
    expect(pushChatMessage).toHaveBeenCalledTimes(1);
  });

  describe('replies and reactions', () => {
    const deliver = (text: string, sec: number) => {
      const id = `ch:3:${sec}:${text}`;
      const timestamp = sec * 1000;
      upsertMessage(TAK_ID, { id, from: 0, to: 0, payload: text, channelIndex: 3, timestamp });
      meshcoreIngestHandleTextMessage(TAK_ID, {
        type: 'text_message',
        payload: { id, from: 0, to: 0, payload: text, channelIndex: 3, timestamp },
      });
    };
    const sentText = () => (pushChatMessage.mock.calls.at(-1)?.[0] as { text: string }).text;

    beforeEach(() => {
      serveTakChannel(TAK_ID, 3, '0123456789abcdef');
      deliver('Alice: meet at the trailhead at 9', 1_700_000_900);
    });

    it.each([
      ['a reaction', 'Bob: @[Alice] 👍', '👍 to Alice: "meet at the trailhead at 9"'],
      [
        'a keyed reaction',
        'Bob: @[Alice#1700000900000] 👍',
        '👍 to Alice: "meet at the trailhead at 9"',
      ],
      ['a reply', 'Bob: @[Alice] copy that', '@Alice copy that'],
      ['a reply to a message not heard', 'Bob: @[Carol] you there?', '@Carol you there?'],
      ['a plain message', 'Bob: on my way', 'on my way'],
      [
        'an MECP report sent as a reply',
        'Bob: @[Alice] MECP/1/M05',
        '@Alice 🚨 URGENT: Hypothermia\nMECP/1/M05',
      ],
    ])('hands on %s with what it answers', (_label, wire, expected) => {
      deliver(wire, 1_700_000_960);
      expect(sentText()).toBe(expected);
    });
  });

  it('hands on two replies alike but for whom they answer, sent in the same second', () => {
    serveTakChannel(TAK_ID, 3, '0123456789abcdef');
    const deliver = (text: string, sec: number) => {
      const id = `ch:3:${sec}:${text}`;
      const timestamp = sec * 1000;
      upsertMessage(TAK_ID, { id, from: 0, to: 0, payload: text, channelIndex: 3, timestamp });
      meshcoreIngestHandleTextMessage(TAK_ID, {
        type: 'text_message',
        payload: { id, from: 0, to: 0, payload: text, channelIndex: 3, timestamp },
      });
    };
    deliver('Alice: hello', 1_700_000_900);
    deliver('Carol: hi all', 1_700_000_901);
    pushChatMessage.mockClear();
    deliver('Bob: @[Alice] 👍', 1_700_000_960);
    deliver('Bob: @[Carol] 👍', 1_700_000_960);
    expect(pushChatMessage).toHaveBeenCalledTimes(2);
  });

  it('does not hand on channels that are not served', () => {
    serveTakChannel(TAK_ID, 4, 'fedcba9876543210');
    channelMessage('Bob: on scene');
    expect(pushChatMessage).not.toHaveBeenCalled();
  });

  describe('direct messages', () => {
    const pushDirectMessage = vi.fn().mockResolvedValue(undefined);
    const PEER = 0xabcd;

    /** A DM as PacketRouter stores it before the ingest listener runs. */
    function directMessage(payload: string, timestamp = 1_700_000_500_000) {
      const id = `${PEER}:${timestamp / 1000}`;
      const record = { id, from: PEER, to: 0, payload, channelIndex: -1, timestamp };
      upsertMessage(TAK_ID, { ...record, senderName: 'Alice' });
      meshcoreIngestHandleTextMessage(TAK_ID, { type: 'text_message', payload: record });
    }

    beforeEach(() => {
      vi.spyOn(window.electronAPI.tak, 'pushDirectMessage').mockImplementation(pushDirectMessage);
      pushDirectMessage.mockClear();
      resetTakRelayedDirectMessages();
      setTakRadio('meshcore', TAK_ID);
    });

    afterEach(() => {
      setTakRadio('meshcore', null);
    });

    it('hands a heard DM to TAK clients when direct messages are on, once', () => {
      directMessage('meet at the gate');
      expect(pushDirectMessage).not.toHaveBeenCalled();

      useTakRelayPrefsStore.getState().setDirectMessages(TAK_ID, true);
      directMessage('meet at the gate', 1_700_000_600_000);
      // The sender did not hear the ack and sent it again.
      directMessage('meet at the gate', 1_700_000_600_000);
      expect(pushDirectMessage).toHaveBeenCalledTimes(1);
      expect(pushDirectMessage).toHaveBeenCalledWith({
        protocol: 'meshcore',
        nodeId: PEER,
        senderCallsign: 'Alice',
        text: 'meet at the gate',
        timeMs: 1_700_000_600_000,
      });
      expect(pushChatMessage).not.toHaveBeenCalled();
    });
  });
});

describe('MeshCore MQTT channel messages to TAK', () => {
  const MQTT_ID = 'meshcore-mqtt-tak-test';
  const pushChatMessage = vi.fn().mockResolvedValue(undefined);

  const message = {
    sender_id: 42,
    sender_name: 'Bob',
    payload: 'on scene',
    channel: 3,
    timestamp: 1_700_000_700_000,
  };

  beforeEach(() => {
    vi.spyOn(window.electronAPI.tak, 'pushChatMessage').mockImplementation(pushChatMessage);
    pushChatMessage.mockClear();
    useMessageStore.setState({ messages: {} });
    useTakRelayPrefsStore.setState({ byIdentity: {} });
    useTakChannelStore.setState({ channelsByIdentity: {} });
    resetTakRelayedChannelLines();
    setTakSinkActive(true);
    serveTakChannel(MQTT_ID, 3, '0123456789abcdef');
  });

  afterEach(() => {
    setTakSinkActive(false);
    useConnectionStore.setState({ connections: {} });
    resetTakEchoForTests();
    vi.restoreAllMocks();
  });

  it('relays a newly inserted MQTT channel message once', () => {
    relayInsertedMeshcoreMqttChannel({
      inserted: true,
      identityId: MQTT_ID,
      message,
      wireText: 'Bob: on scene',
      displayName: 'Bob',
      prior: [],
    });
    expect(pushChatMessage).toHaveBeenCalledTimes(1);
    expect(pushChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelKey: '0123456789abcdef',
        senderCallsign: 'Bob',
        text: 'on scene',
      }),
    );
  });

  it('lets consumeTakEcho drop the line while the local node is unknown', () => {
    rememberTakSend(MQTT_ID, 3, 'on scene');
    relayInsertedMeshcoreMqttChannel({
      inserted: true,
      identityId: MQTT_ID,
      message,
      wireText: 'Bob: on scene',
      displayName: 'Bob',
      prior: [],
    });
    expect(pushChatMessage).not.toHaveBeenCalled();
  });

  it('relays when the sender is known to be another node, even if the text matches a TAK echo', () => {
    setConnection(MQTT_ID, { myNodeNum: 7, status: 'connected' });
    rememberTakSend(MQTT_ID, 3, 'on scene');
    relayInsertedMeshcoreMqttChannel({
      inserted: true,
      identityId: MQTT_ID,
      message,
      wireText: 'Bob: on scene',
      displayName: 'Bob',
      prior: [],
    });
    expect(pushChatMessage).toHaveBeenCalledTimes(1);
  });

  it('does not relay a message already stored from RF', () => {
    relayInsertedMeshcoreMqttChannel({
      inserted: false,
      identityId: MQTT_ID,
      message,
      wireText: 'Bob: on scene',
      displayName: 'Bob',
      prior: [],
    });
    expect(pushChatMessage).not.toHaveBeenCalled();
  });

  it('calls the helper with the MQTT dedup result after the message is stored', () => {
    const source = loadRuntimeSource('useMeshcoreRuntime.ts');
    const start = source.indexOf('mqtt.onMeshcoreChat');
    const end = source.indexOf('}, [addMessage, readMeshcoreNodes]);', start);
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, end);
    const stored = body.indexOf('const added = addMessage(');
    const relay = body.indexOf('relayInsertedMeshcoreMqttChannel({');
    expect(stored).toBeGreaterThan(-1);
    expect(relay).toBeGreaterThan(stored);
    expect(body).toContain('inserted: added.inserted');
  });
});
