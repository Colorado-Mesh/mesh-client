import { afterEach, describe, expect, it, vi } from 'vitest';

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
  syncMeshcoreDisplayReplyRepairs,
  upsertMeshcoreMessageWithDedup,
} from './meshcoreStoreDedup';
import { chatMessageToMessageRecord } from './storeRecordAdapters';
import type { ChatMessage } from './types';

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

  it('merges duplicate RF channel hears within the channel RF window', () => {
    const tsMs = 1_700_000_020_000;
    const first = buildMeshcoreChannelIncomingMessage([], {
      rawText: 'Alice: hello again',
      senderId: 0xabcd1234,
      displayName: 'Alice',
      channel: 0,
      timestamp: tsMs,
      receivedVia: 'rf',
    });
    upsertMeshcoreMessageWithDedup(ID, first);

    const replay = buildMeshcoreChannelIncomingMessage([], {
      rawText: 'Alice: hello again',
      senderId: 0xabcd1234,
      displayName: 'Alice',
      channel: 0,
      timestamp: tsMs + 60_000,
      receivedVia: 'rf',
    });
    const result = upsertMeshcoreMessageWithDedup(ID, replay);

    expect(result.inserted).toBe(false);
    expect(Object.values(useMessageStore.getState().messages[ID] ?? {})).toHaveLength(1);
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

  it('upgrades stale reply_id on cross-transport merge (historical row, RF refresh second)', () => {
    const messageB: ChatMessage = {
      sender_id: 100,
      sender_name: 'NV0N',
      payload: 'Message B - reply to this please.',
      channel: 6,
      timestamp: 1780240608140,
      status: 'acked',
    };
    upsertMeshcoreMessageWithDedup(ID, messageB);

    const mqttStale: ChatMessage = {
      sender_id: 203,
      sender_name: 'Wherewolf',
      payload: 'reply to b',
      channel: 6,
      timestamp: 1780240702000,
      status: 'acked',
      receivedVia: 'mqtt',
      replyId: 1780239830519,
      replyPreviewText: 'Thank you.',
      replyPreviewSender: 'NV0N',
      meshcoreDedupeKey: '@[NV0N] reply to b',
    };
    upsertMeshcoreMessageWithDedup(ID, mqttStale);

    const rfRefreshed: ChatMessage = {
      ...mqttStale,
      receivedVia: 'rf',
      replyId: 1780240608140,
      replyPreviewText: 'Message B - reply to this please.',
      replyPreviewSender: 'NV0N',
      meshcoreDedupeKey: 'Wherewolf: @[NV0N] reply to b',
    };
    const result = upsertMeshcoreMessageWithDedup(ID, rfRefreshed);

    expect(result.message.replyId).toBe(1780240608140);
    expect(result.message.replyPreviewText).toContain('Message B');
  });

  it('syncMeshcoreDisplayReplyRepairs upserts store and persists DB when reply metadata changes', () => {
    const tsMs = 1_700_000_030_000;
    const base: ChatMessage = {
      sender_id: 0xabcd1234,
      sender_name: 'Alice',
      channel: 0,
      timestamp: tsMs,
      payload: 'hello',
      receivedVia: 'rf',
    };
    upsertMessage(ID, chatMessageToMessageRecord(base));
    const storeRecords = [chatMessageToMessageRecord(base)];
    const repaired: ChatMessage[] = [
      {
        ...base,
        replyId: 99,
        replyPreviewSender: 'Bob',
        replyPreviewText: 'prior msg',
      },
    ];
    vi.mocked(window.electronAPI.db.saveMeshcoreMessage).mockClear();
    syncMeshcoreDisplayReplyRepairs(ID, storeRecords, repaired);
    const row = Object.values(useMessageStore.getState().messages[ID] ?? {})[0];
    expect(row?.replyTo).toBe('99');
    expect(window.electronAPI.db.saveMeshcoreMessage).toHaveBeenCalled();
  });
});
