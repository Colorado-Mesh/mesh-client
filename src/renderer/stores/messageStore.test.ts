import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRelayCoverageStore } from '../lib/relayCoverage/relayCoverageStore';
import { mockConsoleWarn } from '../lib/vitestConsoleMock';
import {
  addMessage,
  mergeMessageRecordsFromDbForIdentity,
  type MessageRecord,
  type MessageStoreEvent,
  pruneMessageRecordsForIdentityByChannel,
  renameMessageId,
  replaceMessageRecordsForIdentity,
  subscribeMessageStoreEvents,
  upsertMessage,
  upsertMessageRecordsForIdentity,
  useMessageStore,
  wasMessageBulkLoaded,
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
    useRelayCoverageStore.setState({ coverage: {} });
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

  it('tracks bulk-load provenance per stored record, not per id', () => {
    upsertMessageRecordsForIdentity(ID_A, [sampleRecord('shared', 1)]);
    addMessage(ID_B, sampleRecord('shared', 2));
    const state = useMessageStore.getState().messages;
    expect(wasMessageBulkLoaded(state[ID_A].shared)).toBe(true);
    expect(wasMessageBulkLoaded(state[ID_B].shared)).toBe(false);

    addMessage(ID_A, { ...sampleRecord('shared', 1), payload: 'live edit' });
    expect(wasMessageBulkLoaded(useMessageStore.getState().messages[ID_A].shared)).toBe(false);
  });

  it('mergeMessageRecordsFromDbForIdentity marks DB rows but never demotes a live record', () => {
    addMessage(ID_A, { ...sampleRecord('same', 1), payload: 'live' });
    mergeMessageRecordsFromDbForIdentity(ID_A, [
      { ...sampleRecord('same', 9), payload: 'db' },
      sampleRecord('db-only', 2),
    ]);
    const bucket = useMessageStore.getState().messages[ID_A];
    expect(wasMessageBulkLoaded(bucket['db-only'])).toBe(true);
    expect(wasMessageBulkLoaded(bucket.same)).toBe(false);
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

describe('messageStore events', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('emits added only for new records and renamed only for real renames', () => {
    const events: MessageStoreEvent[] = [];
    const unsubscribe = subscribeMessageStoreEvents((e) => events.push(e));
    try {
      addMessage(ID_A, sampleRecord('m1'));
      addMessage(ID_A, { ...sampleRecord('m1'), payload: 'edited' });
      upsertMessage(ID_A, sampleRecord('m2'));
      renameMessageId(ID_A, 'm1', 'm1');
      renameMessageId(ID_A, 'missing', 'x');
      renameMessageId(ID_A, 'm1', 'wire-1');
    } finally {
      unsubscribe();
    }
    expect(events.map((e) => (e.type === 'added' ? `added:${e.record.id}` : e.type))).toEqual([
      'added:m1',
      'added:m2',
      'renamed',
    ]);
    expect(events[2]).toEqual({ type: 'renamed', identityId: ID_A, fromId: 'm1', toId: 'wire-1' });
  });

  it('stops emitting after unsubscribe and isolates throwing listeners', () => {
    const { spy, restore } = mockConsoleWarn();
    try {
      const good = vi.fn();
      const unsubBad = subscribeMessageStoreEvents(() => {
        throw new Error('boom');
      });
      const unsubGood = subscribeMessageStoreEvents(good);
      addMessage(ID_A, sampleRecord('e1'));
      expect(good).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalled();
      unsubGood();
      unsubBad();
      addMessage(ID_A, sampleRecord('e2'));
      expect(good).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});
