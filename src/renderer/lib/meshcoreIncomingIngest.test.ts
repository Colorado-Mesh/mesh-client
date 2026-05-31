import { afterEach, describe, expect, it } from 'vitest';

import { upsertMessage, useMessageStore } from '../stores/messageStore';
import {
  meshcoreChatMessagesForDisplay,
  parseMeshcoreChannelIncomingFromThread,
  parseMeshcoreDmIncomingFromThread,
} from './meshcoreChannelText';
import {
  ingestMeshcoreChannelMessage,
  listChatMessagesFromStore,
  upsertMeshcoreMessageWithDedup,
} from './meshcoreStoreDedup';
import { chatMessageToMessageRecord } from './storeRecordAdapters';
import type { ChatMessage } from './types';

const ID = 'meshcore-ingest-test';
const NV0N = '🛜 NV0N 01';
const CH = 6;

function nv0n(payload: string, timestamp: number, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    sender_id: 100,
    sender_name: NV0N,
    payload,
    channel: CH,
    timestamp,
    status: 'acked',
    ...extra,
  };
}

function seedStore(messages: ChatMessage[]): void {
  for (const m of messages) {
    upsertMeshcoreMessageWithDedup(ID, m);
  }
}

function wireReply(
  target: string,
  body: string,
  sender: { id: number; name: string },
  timestamp: number,
  receivedVia: ChatMessage['receivedVia'] = 'rf',
): ChatMessage {
  const prior = listChatMessagesFromStore(ID);
  return parseMeshcoreChannelIncomingFromThread(prior, {
    rawText: `${sender.name}: @[${target}] ${body}`,
    senderId: sender.id,
    displayName: sender.name,
    channel: CH,
    timestamp,
    receivedVia,
  });
}

describe('parseMeshcoreChannelIncomingFromThread (canonical live ingest)', () => {
  afterEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('resolves reply to b to Message B when Thank you is older (Wherewolf DB repro)', () => {
    seedStore([
      nv0n('Thank you.', 1780239830519),
      nv0n('Message B - reply to this please.', 1780240608140),
    ]);
    const parsed = wireReply(
      NV0N,
      'reply to b',
      { id: 203, name: '🫈Wherewolf Mane' },
      1780240702000,
    );
    expect(parsed.replyId).toBe(1780240608140);
    expect(parsed.replyPreviewText).toContain('Message B');
  });

  it('resolves reply to A and to A letter hints (StackCore / Packman repro)', () => {
    seedStore([
      nv0n('Thank you', 1780239056187),
      nv0n('Message A - please reply to this.', 1780239277301),
    ]);
    const stackcore = wireReply(
      NV0N,
      'reply to A',
      { id: 201, name: '⛷️ StackCore' },
      1780239611000,
    );
    expect(stackcore.replyId).toBe(1780239277301);

    const prior = listChatMessagesFromStore(ID);
    const packman = parseMeshcoreChannelIncomingFromThread(prior, {
      rawText: `Packman Home: @[${NV0N}] to A`,
      senderId: 202,
      displayName: 'Packman Home',
      channel: CH,
      timestamp: 1780239722000,
      receivedVia: 'rf',
    });
    expect(packman.replyId).toBe(1780239277301);
  });

  it('resolves reply to 7 numeric hint (Wherewolf message 7 repro)', () => {
    seedStore([
      nv0n('thank you', 1780238318795),
      nv0n('oh we have a 6 so that was 7.  Please reply to this one', 1780238482088),
    ]);
    const parsed = wireReply(
      NV0N,
      'reply to 7',
      { id: 203, name: '🫈Wherewolf Mane' },
      1780238600000,
    );
    expect(parsed.replyId).toBe(1780238482088);
  });

  it('resolves reply to message 6 pattern (BC02 repro)', () => {
    const message6Ts = 1780238264178;
    seedStore([
      nv0n('oh man, still off…', 1780237897783),
      nv0n('Message 6 - someone please reply to this.', message6Ts),
    ]);
    const parsed = wireReply(NV0N, 'reply to message 6', { id: 204, name: 'BC02' }, 1780238300000);
    expect(parsed.replyId).toBe(message6Ts);
  });

  it('resolves quoted parent text in reply body (Alex repro)', () => {
    const parentTs = 1780238482088;
    seedStore([
      nv0n('thank you', 1780238318795),
      nv0n('oh we have a 6 so that was 7.  Please reply to this one', parentTs),
    ]);
    const prior = listChatMessagesFromStore(ID);
    const parsed = parseMeshcoreChannelIncomingFromThread(prior, {
      rawText: `🆎 Alex KØALB: @[${NV0N}] reply to "oh we have a 6 so that was 7.  Please reply to this one"`,
      senderId: 205,
      displayName: '🆎 Alex KØALB',
      channel: CH,
      timestamp: 1780238700000,
      receivedVia: 'rf',
    });
    expect(parsed.replyId).toBe(parentTs);
  });

  it('does not re-point own outbound explicit replyId when newer NV0N messages exist', () => {
    seedStore([nv0n('message 2', 1780235760847), nv0n('my reply looked good.', 1780236195022)]);
    const prior = listChatMessagesFromStore(ID);
    const outbound = parseMeshcoreChannelIncomingFromThread(prior, {
      rawText: `${NV0N}: @[${NV0N}#1780235760847] test reply to message 2`,
      senderId: 100,
      displayName: NV0N,
      channel: CH,
      timestamp: 1780236200000,
      receivedVia: 'rf',
    });
    expect(outbound.replyId).toBe(1780235760847);
    expect(outbound.replyPreviewText).toContain('message 2');
  });

  it('plain channel text has no reply parent', () => {
    seedStore([nv0n('hello mesh', 1000)]);
    const prior = listChatMessagesFromStore(ID);
    const parsed = parseMeshcoreChannelIncomingFromThread(prior, {
      rawText: 'Someone: hello back',
      senderId: 50,
      displayName: 'Someone',
      channel: CH,
      timestamp: 2000,
      receivedVia: 'rf',
    });
    expect(parsed.replyId).toBeUndefined();
  });
});

describe('ingestMeshcoreChannelMessage + store persist', () => {
  afterEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('persists corrected reply into Zustand when parent was seeded first', () => {
    upsertMeshcoreMessageWithDedup(ID, nv0n('Message B - reply to this please.', 1780240608140));
    const parsed = ingestMeshcoreChannelMessage(ID, {
      rawText: `🫈Wherewolf Mane: @[${NV0N}] reply to b`,
      senderId: 203,
      displayName: '🫈Wherewolf Mane',
      channel: CH,
      timestamp: 1780240702000,
      receivedVia: 'rf',
    });
    const result = upsertMeshcoreMessageWithDedup(ID, parsed);
    expect(result.message.replyId).toBe(1780240608140);
    const inStore = listChatMessagesFromStore(ID).find((m) => m.payload === 'reply to b');
    expect(inStore?.replyId).toBe(1780240608140);
    expect(inStore?.replyPreviewText).toContain('Message B');
  });

  it('cross-transport dedup upgrades stale historical row when RF re-ingest arrives', () => {
    upsertMeshcoreMessageWithDedup(ID, nv0n('Message B - reply to this please.', 1780240608140));
    upsertMeshcoreMessageWithDedup(ID, {
      sender_id: 203,
      sender_name: '🫈Wherewolf Mane',
      payload: 'reply to b',
      channel: CH,
      timestamp: 1780240702000,
      status: 'acked',
      receivedVia: 'mqtt',
      replyId: 1780239830519,
      replyPreviewText: 'Thank you.',
      replyPreviewSender: NV0N,
      meshcoreDedupeKey: `@[${NV0N}] reply to b`,
    });

    const rfRefreshed = ingestMeshcoreChannelMessage(ID, {
      rawText: `🫈Wherewolf Mane: @[${NV0N}] reply to b`,
      senderId: 203,
      displayName: '🫈Wherewolf Mane',
      channel: CH,
      timestamp: 1780240702500,
      receivedVia: 'rf',
      rxHops: 1,
    });
    const result = upsertMeshcoreMessageWithDedup(ID, rfRefreshed);
    expect(result.storeUpdated).toBe(true);
    expect(result.message.replyId).toBe(1780240608140);
  });
});

describe('meshcoreChatMessagesForDisplay (historical backfill only)', () => {
  it('repairs stale DB reply_id when full thread is present at hydrate', () => {
    const rows: ChatMessage[] = [
      nv0n('Thank you.', 1780239830519),
      nv0n('Message B - reply to this please.', 1780240608140),
      {
        sender_id: 203,
        sender_name: '🫈Wherewolf Mane',
        payload: 'reply to b',
        channel: CH,
        timestamp: 1780240702000,
        status: 'acked',
        replyId: 1780239830519,
        replyPreviewText: 'Thank you.',
        replyPreviewSender: NV0N,
      },
    ];
    const out = meshcoreChatMessagesForDisplay(rows);
    const wherewolf = out.find((m) => m.payload === 'reply to b');
    expect(wherewolf?.replyId).toBe(1780240608140);
  });

  it('does not replace live-ingest-correct rows on display pass', () => {
    seedStore([nv0n('Message B - reply to this please.', 1780240608140)]);
    const correct = wireReply(
      NV0N,
      'reply to b',
      { id: 203, name: '🫈Wherewolf Mane' },
      1780240702000,
    );
    upsertMeshcoreMessageWithDedup(ID, correct);
    const fromStore = listChatMessagesFromStore(ID);
    const out = meshcoreChatMessagesForDisplay(fromStore);
    const wherewolf = out.find((m) => m.payload === 'reply to b');
    expect(wherewolf?.replyId).toBe(1780240608140);
  });
});

describe('parseMeshcoreDmIncomingFromThread', () => {
  afterEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('resolves DM bracket reply against thread', () => {
    const parentTs = 5000;
    upsertMessage(
      ID,
      chatMessageToMessageRecord({
        sender_id: 10,
        sender_name: 'Alice',
        payload: 'meet at noon',
        channel: -1,
        timestamp: parentTs,
        status: 'acked',
        to: 99,
      }),
    );
    const prior = listChatMessagesFromStore(ID);
    const parsed = parseMeshcoreDmIncomingFromThread(prior, {
      rawText: '@[Alice] sounds good',
      senderId: 10,
      displayName: 'Alice',
      timestamp: 6000,
      receivedVia: 'rf',
      peerNodeId: 10,
      myNodeId: 99,
      to: 99,
    });
    expect(parsed.replyId).toBe(parentTs);
  });
});
