import { describe, expect, it } from 'vitest';

import {
  addMessage,
  type MessageRecord,
  updateMessageStatus,
  useMessageStore,
} from '../stores/messageStore';
import { OFFLINE_MESHTASTIC_IDENTITY_ID } from './offlineProtocolIdentities';
import {
  messageRecordsToChatMessages,
  messageRecordToChatMessage,
  messageRecordToChatMessageCached,
} from './storeRecordAdapters';

describe('messageRecordToChatMessage cache', () => {
  it('returns the same ChatMessage reference for the same MessageRecord object', () => {
    const record: MessageRecord = {
      id: '42',
      from: 1,
      to: 0,
      payload: 'hi',
      channelIndex: 0,
      timestamp: 100,
      status: 'acked',
    };
    const a = messageRecordToChatMessageCached(record);
    const b = messageRecordToChatMessageCached(record);
    expect(a).toBe(b);
    expect(messageRecordsToChatMessages([record])[0]).toBe(a);
  });

  it('does not cache through the uncached converter', () => {
    const record: MessageRecord = {
      id: '43',
      from: 1,
      to: 0,
      payload: 'hi',
      channelIndex: 0,
      timestamp: 100,
      status: 'acked',
    };
    const a = messageRecordToChatMessage(record);
    const b = messageRecordToChatMessage(record);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('invalidates when the store replaces the record object', () => {
    useMessageStore.setState({ messages: {} });
    const id = 'cache-status-1';
    addMessage(OFFLINE_MESHTASTIC_IDENTITY_ID, {
      id,
      from: 1,
      to: 0,
      payload: 'sending',
      channelIndex: 0,
      timestamp: 100,
      status: 'sending',
    });
    const first = useMessageStore.getState().messages[OFFLINE_MESHTASTIC_IDENTITY_ID][id];
    const firstChat = messageRecordToChatMessageCached(first);
    updateMessageStatus(OFFLINE_MESHTASTIC_IDENTITY_ID, id, 'acked');
    const second = useMessageStore.getState().messages[OFFLINE_MESHTASTIC_IDENTITY_ID][id];
    expect(second).not.toBe(first);
    const secondChat = messageRecordToChatMessageCached(second);
    expect(secondChat).not.toBe(firstChat);
    expect(secondChat.status).toBe('acked');
  });
});
