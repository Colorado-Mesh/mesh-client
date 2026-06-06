import { beforeEach, describe, expect, it } from 'vitest';

import { addMessage, type MessageRecord, useMessageStore } from './messageStore';

const ID_A = 'identity-a';
const ID_B = 'identity-b';

function sampleRecord(id: string, from = 1): MessageRecord {
  return {
    id,
    from,
    to: 0,
    payload: 'hello',
    channelIndex: 0,
    timestamp: 1_700_000_000_000,
  };
}

describe('messageStore structural sharing', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('preserves other identity bucket references when adding to one identity', () => {
    addMessage(ID_B, sampleRecord('b1'));
    const bucketBefore = useMessageStore.getState().messages[ID_B];

    addMessage(ID_A, sampleRecord('a1'));

    expect(useMessageStore.getState().messages[ID_B]).toBe(bucketBefore);
    expect(useMessageStore.getState().messages[ID_A]?.a1).toBeDefined();
  });

  it('no-ops when inserting an identical record', () => {
    const record = sampleRecord('same');
    addMessage(ID_A, record);
    const stateBefore = useMessageStore.getState();

    addMessage(ID_A, { ...record });

    expect(useMessageStore.getState()).toBe(stateBefore);
  });
});
