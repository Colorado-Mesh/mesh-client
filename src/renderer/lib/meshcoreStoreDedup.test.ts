import { afterEach, describe, expect, it } from 'vitest';

import { MESHCORE_ROOM_MESSAGE_CHANNEL } from '../hooks/meshcore/meshcoreHookPreamble';
import { upsertMessage, useMessageStore } from '../stores/messageStore';
import { buildMeshcoreChannelIncomingMessage } from './meshcoreChannelText';
import {
  meshcoreChannelMessageStoreId,
  meshcoreMessageStoreId,
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
});
