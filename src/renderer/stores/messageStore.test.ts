import { beforeEach, describe, expect, it } from 'vitest';

import {
  addMessage,
  mergeMessageRecordsFromDbForIdentity,
  type MessageRecord,
  pruneMessageRecordsForIdentityByChannel,
  renameMessageId,
  replaceMessageRecordsForIdentity,
  updateMessageStatus,
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

  it('mergeMessageRecordsFromDbForIdentity keeps live rows missing from DB', () => {
    addMessage(ID_A, sampleRecord('live', 1));
    mergeMessageRecordsFromDbForIdentity(ID_A, [sampleRecord('db', 2)]);
    const bucket = useMessageStore.getState().messages[ID_A];
    expect(bucket?.live?.from).toBe(1);
    expect(bucket?.db?.from).toBe(2);
  });

  it('mergeMessageRecordsFromDbForIdentity lets DB win on id collision', () => {
    addMessage(ID_A, { ...sampleRecord('same', 1), payload: 'live' });
    mergeMessageRecordsFromDbForIdentity(ID_A, [{ ...sampleRecord('same', 9), payload: 'db' }]);
    expect(useMessageStore.getState().messages[ID_A]?.same?.payload).toBe('db');
    expect(useMessageStore.getState().messages[ID_A]?.same?.from).toBe(9);
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

describe('messageStore rename / status guards for Reticulum Completes', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('renameMessageId does not clobber an acked Completes target', () => {
    const successHash = 'aa'.repeat(32);
    const failedHash = 'bb'.repeat(32);
    addMessage(ID_A, {
      ...sampleRecord(successHash),
      payload: 'just delivered',
      status: 'acked',
      timestamp: 2_000,
    });
    addMessage(ID_A, {
      ...sampleRecord(failedHash),
      payload: 'older failed',
      status: 'sending',
      timestamp: 1_000,
    });

    renameMessageId(ID_A, failedHash, successHash);

    const bucket = useMessageStore.getState().messages[ID_A] ?? {};
    expect(bucket[failedHash]).toBeUndefined();
    expect(bucket[successHash]).toMatchObject({
      payload: 'just delivered',
      status: 'acked',
    });
  });

  it('renameMessageId still rekeys onto a vacant or non-acked target', () => {
    const pending = 'reticulum-pending-1';
    const hash = 'cc'.repeat(32);
    addMessage(ID_A, {
      ...sampleRecord(pending),
      payload: 'going out',
      status: 'sending',
    });

    renameMessageId(ID_A, pending, hash);

    const bucket = useMessageStore.getState().messages[ID_A] ?? {};
    expect(bucket[pending]).toBeUndefined();
    expect(bucket[hash]).toMatchObject({ id: hash, payload: 'going out', status: 'sending' });
  });

  it('updateMessageStatus refuses acked → sending', () => {
    const hash = 'dd'.repeat(32);
    addMessage(ID_A, { ...sampleRecord(hash), status: 'acked', payload: 'done' });
    updateMessageStatus(ID_A, hash, 'sending');
    expect(useMessageStore.getState().messages[ID_A]?.[hash]?.status).toBe('acked');
  });
});
