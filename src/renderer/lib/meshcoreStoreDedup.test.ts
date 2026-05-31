import { afterEach, describe, expect, it } from 'vitest';

import { MESHCORE_ROOM_MESSAGE_CHANNEL } from '../hooks/meshcore/meshcoreHookPreamble';
import { upsertMessage, useMessageStore } from '../stores/messageStore';
import {
  buildMeshcoreChannelIncomingMessage,
  buildMeshcoreRoomIncomingMessage,
} from './meshcoreChannelText';
import {
  meshcoreChannelMessageStoreId,
  meshcoreMessageStoreId,
  meshcoreRoomMessageStoreId,
  upsertMeshcoreMessageWithDedup,
} from './meshcoreStoreDedup';

const ID = 'meshcore-dedup-test';

describe('meshcoreStoreDedup', () => {
  afterEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('uses ch: channel ids aligned with PacketRouter', () => {
    expect(meshcoreChannelMessageStoreId(0, 1_700_000_010)).toBe('ch:0:1700000010');
  });

  it('merges RF store row with MQTT duplicate into one entry', () => {
    const tsSec = 1_700_000_010;
    const tsMs = tsSec * 1000;
    upsertMessage(ID, {
      id: `ch:0:${tsSec}`,
      from: 0xabcd1234,
      senderName: 'Alice',
      to: 0xffffffff,
      payload: 'hello mesh',
      channelIndex: 0,
      timestamp: tsMs,
      receivedVia: 'rf',
    });

    const mqttMsg = buildMeshcoreChannelIncomingMessage([], {
      rawText: 'Alice: hello mesh',
      senderId: 0xabcd1234,
      displayName: 'Alice',
      channel: 0,
      timestamp: tsMs + 500,
      receivedVia: 'mqtt',
    });

    const result = upsertMeshcoreMessageWithDedup(ID, mqttMsg);
    expect(result.inserted).toBe(false);
    expect(result.message.receivedVia).toBe('both');

    const rows = Object.values(useMessageStore.getState().messages[ID] ?? {});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.receivedVia).toBe('both');
  });

  it('merges receivedVia on exact dedupe-key match', () => {
    const tsMs = 1_700_000_010_000;
    const channelMsg = buildMeshcoreChannelIncomingMessage([], {
      rawText: 'Alice: hello mesh',
      senderId: 0xabcd1234,
      displayName: 'Alice',
      channel: 0,
      timestamp: tsMs,
      receivedVia: 'rf',
    });
    upsertMeshcoreMessageWithDedup(ID, channelMsg);

    const mqttDup = { ...channelMsg, receivedVia: 'mqtt' as const };
    const result = upsertMeshcoreMessageWithDedup(ID, mqttDup);
    expect(result.inserted).toBe(false);
    expect(result.message.receivedVia).toBe('both');
    expect(useMessageStore.getState().messages[ID]?.[result.canonicalId]?.receivedVia).toBe('both');
  });

  it('assigns room store ids for room server posts', () => {
    const roomId = 0xac200e59;
    const msg = {
      sender_id: 0x11,
      sender_name: 'Author',
      payload: 'Welcome',
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: 1_700_000_000_000,
      roomServerId: roomId,
      to: roomId,
      receivedVia: 'rf' as const,
      meshcoreDedupeKey: 'Welcome',
    };
    expect(meshcoreMessageStoreId(msg)).toBe(`room:${roomId >>> 0}:1700000000`);
  });

  it('merges optimistic room post with firmware RF echo', () => {
    const roomId = 0xac200e59;
    const authorId = 0x11;
    const firmwareTsMs = 1_700_000_000_000;
    const clientTsMs = firmwareTsMs + 2_500;

    const optimistic = {
      sender_id: authorId,
      sender_name: 'NV0N 01',
      payload: 'Testing from the mesh-client',
      meshcoreDedupeKey: 'Testing from the mesh-client',
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: clientTsMs,
      status: 'sending' as const,
      roomServerId: roomId,
      to: roomId,
    };
    upsertMeshcoreMessageWithDedup(ID, optimistic);

    const echo = buildMeshcoreRoomIncomingMessage({
      rawText: 'Testing from the mesh-client',
      roomServerId: roomId,
      authorId,
      authorName: 'NV0N 01',
      timestamp: firmwareTsMs,
      receivedVia: 'rf',
    });
    const result = upsertMeshcoreMessageWithDedup(
      ID,
      echo,
      meshcoreRoomMessageStoreId(roomId, Math.floor(firmwareTsMs / 1000)),
    );

    expect(result.inserted).toBe(false);
    expect(result.message.timestamp).toBe(firmwareTsMs);
    expect(result.message.status).toBe('acked');
    expect(Object.values(useMessageStore.getState().messages[ID] ?? {})).toHaveLength(1);
  });

  it('merges duplicate room posts from dual ingress with identical firmware timestamp', () => {
    const roomId = 0xac200e59;
    const authorId = 0x22;
    const tsMs = 1_700_000_001_000;
    const tsSec = Math.floor(tsMs / 1000);
    const canonicalId = meshcoreRoomMessageStoreId(roomId, tsSec);

    const first = buildMeshcoreRoomIncomingMessage({
      rawText: 'Hello room',
      roomServerId: roomId,
      authorId,
      authorName: 'Alice',
      timestamp: tsMs,
      receivedVia: 'rf',
    });
    upsertMeshcoreMessageWithDedup(ID, first, canonicalId);

    const replay = buildMeshcoreRoomIncomingMessage({
      rawText: 'Hello room',
      roomServerId: roomId,
      authorId,
      authorName: 'Alice',
      timestamp: tsMs,
      receivedVia: 'rf',
    });
    const result = upsertMeshcoreMessageWithDedup(ID, replay, canonicalId);

    expect(result.inserted).toBe(false);
    expect(Object.values(useMessageStore.getState().messages[ID] ?? {})).toHaveLength(1);
  });

  it('merges optimistic room post ack on exact dedupe key', () => {
    const roomId = 0xac200e59;
    const authorId = 0x44;
    const sentAt = 1_700_000_003_000;

    const optimistic = {
      sender_id: authorId,
      sender_name: 'Me',
      payload: 'wave',
      meshcoreDedupeKey: 'wave',
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: sentAt,
      status: 'sending' as const,
      roomServerId: roomId,
      to: roomId,
    };
    upsertMeshcoreMessageWithDedup(ID, optimistic);

    const acked = { ...optimistic, status: 'acked' as const, packetId: 0xdeadbeef };
    const result = upsertMeshcoreMessageWithDedup(ID, acked);

    expect(result.inserted).toBe(false);
    expect(result.message.status).toBe('acked');
    expect(result.message.packetId).toBe(0xdeadbeef);
    expect(useMessageStore.getState().messages[ID]?.[result.canonicalId]?.status).toBe('acked');
  });

  it('merges optimistic room post failed on exact dedupe key', () => {
    const roomId = 0xac200e59;
    const authorId = 0x55;
    const sentAt = 1_700_000_004_000;

    const optimistic = {
      sender_id: authorId,
      sender_name: 'Me',
      payload: 'oops',
      meshcoreDedupeKey: 'oops',
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: sentAt,
      status: 'sending' as const,
      roomServerId: roomId,
      to: roomId,
    };
    upsertMeshcoreMessageWithDedup(ID, optimistic);

    const failed = { ...optimistic, status: 'failed' as const, error: 'timeout' };
    const result = upsertMeshcoreMessageWithDedup(ID, failed);

    expect(result.inserted).toBe(false);
    expect(result.message.status).toBe('failed');
    expect(result.message.error).toBe('timeout');
  });

  it('merges event-131 replay with live event-7 room post within skew window', () => {
    const roomId = 0xac200e59;
    const authorId = 0x33;
    const tsMs = 1_700_000_002_000;

    upsertMeshcoreMessageWithDedup(
      ID,
      buildMeshcoreRoomIncomingMessage({
        rawText: 'Sync replay',
        roomServerId: roomId,
        authorId,
        authorName: 'Bob',
        timestamp: tsMs,
        receivedVia: 'rf',
      }),
    );

    const result = upsertMeshcoreMessageWithDedup(
      ID,
      buildMeshcoreRoomIncomingMessage({
        rawText: 'Sync replay',
        roomServerId: roomId,
        authorId,
        authorName: 'Bob',
        timestamp: tsMs + 500,
        receivedVia: 'rf',
      }),
      meshcoreRoomMessageStoreId(roomId, Math.floor((tsMs + 500) / 1000)),
    );

    expect(result.inserted).toBe(false);
    expect(Object.values(useMessageStore.getState().messages[ID] ?? {})).toHaveLength(1);
  });
});
