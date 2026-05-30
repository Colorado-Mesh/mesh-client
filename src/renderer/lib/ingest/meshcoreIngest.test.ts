import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { upsertMessage, useMessageStore } from '../../stores/messageStore';
import { useNodeStore } from '../../stores/nodeStore';
import { packetRouter } from '../drivers/PacketRouter';
import {
  MESHCORE_UNKNOWN_SENDER_STUB_ID,
  meshcoreChatStubNodeIdFromDisplayName,
} from '../meshcoreUtils';
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
    const row = useMessageStore.getState().messages[ID]?.[msgId];
    expect(row?.from).toBe(0);
    expect(row?.from).not.toBe(MESHCORE_UNKNOWN_SENDER_STUB_ID);
    expect(saveMeshcoreMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sender_id: null, sender_name: 'Unknown' }),
    );
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
    const row = useMessageStore.getState().messages[ID]?.[incomingId];
    expect(row?.from).toBe(namedId);
    expect(row?.senderName).toBe('Alice');
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
    const row = useMessageStore.getState().messages[ID]?.[msgId];
    expect(row?.roomServerId).toBe(roomId);
    expect(row?.channelIndex).toBe(-2);
    expect(row?.payload).toBe('Hi room');
    expect(saveMeshcoreMessage).toHaveBeenCalledWith(
      expect.objectContaining({ room_server_id: roomId, channel_idx: -2, payload: 'Hi room' }),
    );
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
});
