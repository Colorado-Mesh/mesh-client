import { afterEach, describe, expect, it } from 'vitest';

import {
  addMessage,
  type MessageRecord,
  renameMessageId,
  updateMessageStatus,
  upsertMessage,
  useMessageStore,
} from './messageStore';

const ID = 'identity-1';

function makeMsg(id: string, payload = 'hi'): MessageRecord {
  return {
    id,
    from: 1,
    to: 2,
    payload,
    channelIndex: 0,
    timestamp: 1000,
  };
}

describe('messageStore', () => {
  afterEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('upsertMessage adds when not present', () => {
    upsertMessage(ID, makeMsg('m1'));
    expect(useMessageStore.getState().messages[ID].m1.payload).toBe('hi');
  });

  it('upsertMessage merges into existing without losing fields', () => {
    addMessage(ID, { ...makeMsg('m1'), status: 'sending' });
    upsertMessage(ID, { ...makeMsg('m1'), rxSnr: 7 });
    const rec = useMessageStore.getState().messages[ID].m1;
    expect(rec.status).toBe('sending');
    expect(rec.rxSnr).toBe(7);
  });

  it('renameMessageId moves under new id and clears old one', () => {
    addMessage(ID, makeMsg('pending:abc', 'optimistic'));
    renameMessageId(ID, 'pending:abc', '12345');
    const byId = useMessageStore.getState().messages[ID];
    expect(byId['pending:abc']).toBeUndefined();
    expect(byId['12345'].id).toBe('12345');
    expect(byId['12345'].payload).toBe('optimistic');
  });

  it('renameMessageId is a no-op when source id missing', () => {
    renameMessageId(ID, 'nope', 'real');
    expect(useMessageStore.getState().messages[ID]).toBeUndefined();
  });

  it('updateMessageStatus sets error when provided', () => {
    addMessage(ID, { ...makeMsg('m1'), status: 'sending' });
    updateMessageStatus(ID, 'm1', 'failed', 'timeout');
    expect(useMessageStore.getState().messages[ID].m1).toMatchObject({
      status: 'failed',
      error: 'timeout',
    });
  });

  it('updateMessageStatus preserves error when omitted on failed', () => {
    addMessage(ID, { ...makeMsg('m1'), status: 'failed', error: 'timeout' });
    updateMessageStatus(ID, 'm1', 'failed');
    expect(useMessageStore.getState().messages[ID].m1.error).toBe('timeout');
  });

  it('updateMessageStatus clears error on ack when omitted', () => {
    addMessage(ID, { ...makeMsg('m1'), status: 'failed', error: 'timeout' });
    updateMessageStatus(ID, 'm1', 'acked');
    const rec = useMessageStore.getState().messages[ID].m1;
    expect(rec.status).toBe('acked');
    expect(rec.error).toBeUndefined();
  });
});
