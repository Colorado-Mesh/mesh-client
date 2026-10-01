import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mapMeshcoreDbRowsToChatMessages,
  type MeshcoreMessageDbRow,
  messageToDbRow,
} from '../hooks/meshcore/meshcoreHookPreamble';
import {
  addMessage,
  renameMessageId,
  replaceMessageRecordsForIdentity,
  upsertMessage,
  useMessageStore,
} from '../stores/messageStore';
import { meshcoreChatMessagesForDisplay } from './meshcoreChannelText';
import {
  nextMeshcoreMessageLocalOrder,
  observeMeshcoreMessageLocalOrder,
} from './meshcoreMessageOrder';
import { upsertMeshcoreMessageWithDedup } from './meshcoreStoreDedup';
import { chatMessageToMessageRecord, messageRecordsToChatMessages } from './storeRecordAdapters';
import type { ChatMessage } from './types';

const identity = 'synthetic-order';
const second = 1_700_000_000_000;

function message(payload: string, timestamp: number, localOrder?: number): ChatMessage {
  return { sender_id: 1, sender_name: 'Local', to: 2, channel: -1, payload, timestamp, localOrder };
}

function display() {
  return meshcoreChatMessagesForDisplay(
    messageRecordsToChatMessages(
      Object.values(useMessageStore.getState().messages[identity] ?? {}),
    ),
  );
}

describe.each(['linux', 'darwin', 'win32'])('same-second MeshCore DM order on %s', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it.each([160, 576])(
    'keeps a command with %ims precision before its whole-second reply through ACK rename and reload',
    (fraction) => {
      const command = message('command', second + fraction, 101);
      const reply = {
        ...message('response', second, 102),
        sender_id: 2,
        sender_name: 'Remote',
        to: 1,
      };
      addMessage(identity, {
        ...chatMessageToMessageRecord(command),
        id: 'pending',
        status: 'sending',
      });
      upsertMeshcoreMessageWithDedup(identity, reply, 'incoming');
      expect(display().map((m) => m.payload)).toEqual(['command', 'response']);
      renameMessageId(identity, 'pending', '987654');
      upsertMessage(identity, {
        ...chatMessageToMessageRecord(command),
        id: '987654',
        status: 'acked',
        localOrder: 999,
      });
      expect(display().map((m) => m.payload)).toEqual(['command', 'response']);
      expect(useMessageStore.getState().messages[identity]['987654'].localOrder).toBe(101);
      const persisted = display()
        .reverse()
        .map((m, index) => ({
          ...messageToDbRow(m),
          id: index + 1,
        })) as MeshcoreMessageDbRow[];
      const reloaded = mapMeshcoreDbRowsToChatMessages(persisted);
      replaceMessageRecordsForIdentity(identity, reloaded.map(chatMessageToMessageRecord));
      expect(display().map((m) => m.payload)).toEqual(['command', 'response']);
      expect(display().map((m) => m.timestamp)).toEqual([second + fraction, second]);
    },
  );

  it('uses SQLite insertion IDs for legacy rows, including outbound DMs stored on channel zero', () => {
    const rows = [
      {
        id: 20,
        sender_id: 1,
        sender_name: 'Local',
        to_node: 2,
        channel_idx: 0,
        timestamp: second + 250,
        payload: 'command',
      },
      {
        id: 21,
        sender_id: 2,
        sender_name: 'Remote',
        to_node: 1,
        channel_idx: -1,
        timestamp: second,
        payload: 'response',
      },
    ] as MeshcoreMessageDbRow[];
    const mapped = mapMeshcoreDbRowsToChatMessages(rows.reverse());
    expect(mapped.map((m) => m.payload)).toEqual(['command', 'response']);
    expect(mapped.map((m) => m.channel)).toEqual([-1, -1]);
    expect(mapped.map((m) => m.localOrder)).toEqual([20, 21]);
  });

  it('retains first observation order on duplicate replay', () => {
    upsertMeshcoreMessageWithDedup(identity, message('command', second + 200, 10), 'command');
    const reply = { ...message('response', second, 11), sender_id: 2, to: 1 };
    upsertMeshcoreMessageWithDedup(identity, reply, 'reply');
    upsertMeshcoreMessageWithDedup(
      identity,
      { ...reply, localOrder: 99, receivedVia: 'mqtt', isHistory: true },
      'reply',
    );
    expect(display().map((m) => [m.payload, m.localOrder])).toEqual([
      ['command', 10],
      ['response', 11],
    ]);
  });

  it('keeps group/room slots and other seconds unchanged with interleaved peers and delayed history', () => {
    const rows = [
      message('first send', second + 200, 10),
      { ...message('other peer', second + 250, 11), to: 3 },
      { ...message('reply', second, 12), sender_id: 2, to: 1 },
      { ...message('channel', second + 100, 99), channel: 0, to: undefined },
      { ...message('room', second + 150, 99), channel: -2, roomServerId: 5 },
      message('next second', second + 1000, 1),
      { ...message('delayed history', second - 1000, 999), isHistory: true },
    ];
    expect(meshcoreChatMessagesForDisplay(rows).map((m) => m.payload)).toEqual([
      'delayed history',
      'first send',
      'channel',
      'room',
      'other peer',
      'reply',
      'next second',
    ]);
  });

  it('does not depend on the wall clock moving backwards or IDs changing', () => {
    const previous = nextMeshcoreMessageLocalOrder() + 10_000;
    observeMeshcoreMessageLocalOrder(previous);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const first = nextMeshcoreMessageLocalOrder();
      expect(first).toBe(previous + 1);
      expect(nextMeshcoreMessageLocalOrder()).toBe(first + 1);
    } finally {
      clock.mockRestore();
    }
  });
});
