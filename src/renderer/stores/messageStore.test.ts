import { beforeEach, describe, expect, it } from 'vitest';

import {
  addMessage,
  type MessageRecord,
  pruneMessageRecordsForIdentityByChannel,
  replaceMessageRecordsForIdentity,
  useMessageStore,
} from './messageStore';

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

describe('messageStore replace and prune', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('replaceMessageRecordsForIdentity clears prior rows including empty reload', () => {
    addMessage(ID_A, sampleRecord('a1', 1));
    addMessage(ID_A, { ...sampleRecord('a2', 1), channelIndex: 1 });
    replaceMessageRecordsForIdentity(ID_A, []);
    expect(Object.keys(useMessageStore.getState().messages[ID_A] ?? {})).toHaveLength(0);
  });

  it('replaceMessageRecordsForIdentity replaces bucket with DB snapshot', () => {
    addMessage(ID_A, sampleRecord('old', 1));
    replaceMessageRecordsForIdentity(ID_A, [sampleRecord('new', 2)]);
    const bucket = useMessageStore.getState().messages[ID_A];
    expect(bucket?.old).toBeUndefined();
    expect(bucket?.new?.from).toBe(2);
  });

  it('pruneMessageRecordsForIdentityByChannel removes one channel slice', () => {
    addMessage(ID_A, sampleRecord('ch0', 1));
    addMessage(ID_A, { ...sampleRecord('ch1', 1), id: 'ch1', channelIndex: 1 });
    pruneMessageRecordsForIdentityByChannel(ID_A, 0);
    const bucket = useMessageStore.getState().messages[ID_A];
    expect(bucket?.ch0).toBeUndefined();
    expect(bucket?.ch1).toBeDefined();
  });
});
