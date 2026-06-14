import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addIdentity } from '../stores/identityStore';
import { useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import { packetRouter } from './drivers/PacketRouter';
import { attachMeshcoreIngest } from './ingest/meshcoreIngest';
import { registerMeshcorePubKey } from './meshcore/meshcorePubKeyRegistry';
import { MESHCORE_TXT_TYPE_SIGNED_PLAIN } from './meshcoreChannelText';
import {
  decodeMeshcoreDirectMessageEvents,
  dispatchMeshcoreWaitingContactMessage,
} from './meshcoreDirectMessageDecode';
import { meshcoreRoomMessageId } from './meshcoreRoomMessageRouting';
import { pubkeyToNodeId } from './meshcoreUtils';
import { meshcoreProtocol } from './protocols/MeshCoreProtocol';

const ID = 'meshcore-waiting-decode-test';

describe('decodeMeshcoreDirectMessageEvents', () => {
  it('includes author in room message id for SignedPlain posts', () => {
    const roomPubKey = Uint8Array.from({ length: 32 }, (_, i) => i + 10);
    const authorPubKey = Uint8Array.from({ length: 32 }, (_, i) => i + 20);
    const roomId = pubkeyToNodeId(roomPubKey);
    const authorId = pubkeyToNodeId(authorPubKey);
    registerMeshcorePubKey(roomId, roomPubKey);
    registerMeshcorePubKey(authorId, authorPubKey);

    const prefixMap = new Map<string, number>([
      [
        Array.from(roomPubKey.slice(0, 4))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
        roomId,
      ],
      [
        Array.from(authorPubKey.slice(0, 4))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
        authorId,
      ],
    ]);
    const roomNodeIds = new Set<number>([roomId]);
    const authorPrefix = String.fromCharCode(
      authorPubKey[0] & 0xff,
      authorPubKey[1] & 0xff,
      authorPubKey[2] & 0xff,
      authorPubKey[3] & 0xff,
    );

    const events = decodeMeshcoreDirectMessageEvents(
      {
        pubKeyPrefix: roomPubKey.slice(0, 6),
        text: `${authorPrefix}Hello room`,
        senderTimestamp: 1_700_000_100,
        txtType: MESHCORE_TXT_TYPE_SIGNED_PLAIN,
      },
      prefixMap,
      roomNodeIds,
    );

    const text = events.find((e) => e.type === 'text_message');
    expect(text?.type === 'text_message' && text.payload.id).toBe(
      meshcoreRoomMessageId(roomId, 1_700_000_100, authorId),
    );
  });
});

describe('dispatchMeshcoreWaitingContactMessage', () => {
  const saveMeshcoreMessage = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.spyOn(window.electronAPI.db, 'saveMeshcoreMessage').mockImplementation(saveMeshcoreMessage);
    saveMeshcoreMessage.mockClear();
    useMessageStore.setState({ messages: {} });
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    addIdentity({
      id: ID,
      protocol: meshcoreProtocol,
      signature: 'meshcore:waiting-test',
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
  });

  it('persists event-131 room backlog through PacketRouter when identity is bound', () => {
    const roomPubKey = Uint8Array.from({ length: 32 }, (_, i) => i + 30);
    const authorPubKey = Uint8Array.from({ length: 32 }, (_, i) => i + 40);
    const roomId = pubkeyToNodeId(roomPubKey);
    const authorId = pubkeyToNodeId(authorPubKey);
    registerMeshcorePubKey(roomId, roomPubKey);
    registerMeshcorePubKey(authorId, authorPubKey);

    useNodeStore.setState({
      nodes: {
        [ID]: {
          [roomId]: { nodeId: roomId, longName: 'NV0N ROOM', hwModel: 'Room' },
          [authorId]: { nodeId: authorId, longName: 'NV0N 01', hwModel: 'Chat' },
        },
      },
      traceRoutes: {},
      waypoints: {},
      neighborInfo: {},
    });

    const prefixMap = new Map<string, number>([
      [
        Array.from(roomPubKey.slice(0, 4))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
        roomId,
      ],
      [
        Array.from(authorPubKey.slice(0, 4))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
        authorId,
      ],
    ]);
    const authorPrefix = String.fromCharCode(
      authorPubKey[0] & 0xff,
      authorPubKey[1] & 0xff,
      authorPubKey[2] & 0xff,
      authorPubKey[3] & 0xff,
    );

    const detach = attachMeshcoreIngest(ID);
    dispatchMeshcoreWaitingContactMessage(
      ID,
      {
        pubKeyPrefix: roomPubKey.slice(0, 6),
        text: `${authorPrefix}Sync replay post`,
        senderTimestamp: 1_700_000_200,
        txtType: MESHCORE_TXT_TYPE_SIGNED_PLAIN,
      },
      prefixMap,
      new Set([roomId]),
      (event, identityId) => {
        packetRouter.dispatch(event, identityId);
      },
    );
    detach();

    const storeId = meshcoreRoomMessageId(roomId, 1_700_000_200, authorId);
    expect(useMessageStore.getState().messages[ID]?.[storeId]?.payload).toBe('Sync replay post');
    expect(saveMeshcoreMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        room_server_id: roomId,
        channel_idx: -2,
        payload: 'Sync replay post',
      }),
    );
  });

  it('strips binary prefix on event-131 replay without txtType (official app path)', () => {
    const roomPubKey = Uint8Array.from({ length: 32 }, (_, i) => i + 30);
    const authorPubKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    authorPubKey.set([0x93, 0x6c, 0x73, 0x49], 0);
    const roomId = pubkeyToNodeId(roomPubKey);
    const authorId = pubkeyToNodeId(authorPubKey);
    registerMeshcorePubKey(roomId, roomPubKey);
    registerMeshcorePubKey(authorId, authorPubKey);

    useNodeStore.setState({
      nodes: {
        [ID]: {
          [roomId]: { nodeId: roomId, longName: 'NV0N ROOM', hwModel: 'Room' },
          [authorId]: { nodeId: authorId, longName: 'NV0N 01', hwModel: 'Chat' },
        },
      },
      traceRoutes: {},
      waypoints: {},
      neighborInfo: {},
    });

    const prefixMap = new Map<string, number>([
      [
        Array.from(roomPubKey.slice(0, 4))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
        roomId,
      ],
      [
        Array.from(authorPubKey.slice(0, 4))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
        authorId,
      ],
    ]);
    const authorPrefix = String.fromCharCode(0x93, 0x6c, 0x73, 0x49);

    const detach = attachMeshcoreIngest(ID);
    dispatchMeshcoreWaitingContactMessage(
      ID,
      {
        pubKeyPrefix: roomPubKey.slice(0, 6),
        text: `${authorPrefix}From og app backlog`,
        senderTimestamp: 1_700_000_300,
      },
      prefixMap,
      new Set([roomId]),
      (event, identityId) => {
        packetRouter.dispatch(event, identityId);
      },
    );
    detach();

    const storeId = meshcoreRoomMessageId(roomId, 1_700_000_300, authorId);
    expect(useMessageStore.getState().messages[ID]?.[storeId]?.payload).toBe('From og app backlog');
  });
});
