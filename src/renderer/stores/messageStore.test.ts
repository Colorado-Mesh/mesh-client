import { beforeEach, describe, expect, it } from 'vitest';

import { meshcoreNodeHash } from '@/shared/meshcoreNodeHash';

import {
  openHeardRepeatWindow,
  recordMeshcoreRfRx,
  resetHeardRepeatWindowsForTests,
} from '../lib/meshcore/heardRepeatTracker';
import { useRelayCoverageStore } from '../lib/relayCoverage/relayCoverageStore';
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
    useRelayCoverageStore.setState({ coverage: {} });
    resetHeardRepeatWindowsForTests();
  });

  it('renameMessageId re-keys relay coverage with the message id', () => {
    const pending = 'reticulum-pending-1';
    const hash = 'cc'.repeat(32);
    addMessage(ID_A, { ...sampleRecord(pending), status: 'sending' });
    useRelayCoverageStore.getState().set(ID_A, pending, {
      protocol: 'reticulum',
      mode: 'predicted',
      predictedRelayHops: 2,
      predictedFirstHop: 'abcdef',
    });

    renameMessageId(ID_A, pending, hash);

    expect(useRelayCoverageStore.getState().coverageFor(ID_A, pending)).toBeUndefined();
    expect(useRelayCoverageStore.getState().coverageFor(ID_A, hash)?.predictedRelayHops).toBe(2);
  });

  it('renameMessageId keeps MeshCore heard-repeat window on the new message id', () => {
    const provisional = 'out:meshcore-1';
    const persisted = 'wire-meshcore-1';
    const repeaterId = 0x0a0b0c0d;
    addMessage(ID_A, { ...sampleRecord(provisional), status: 'sending' });
    openHeardRepeatWindow(ID_A, provisional);

    renameMessageId(ID_A, provisional, persisted);

    recordMeshcoreRfRx({
      identityId: ID_A,
      isOwnMeshcoreTx: true,
      pathBytes: [meshcoreNodeHash(repeaterId)],
      pathHashSizeBytes: 1,
      myNodeNum: 0x01020304,
      candidates: [{ node_id: repeaterId, last_heard: 200 }],
      resolveRepeater: (nodeId) => (nodeId === repeaterId ? { nodeId, name: 'Rep Alpha' } : null),
    });

    expect(useRelayCoverageStore.getState().coverageFor(ID_A, provisional)).toBeUndefined();
    expect(useRelayCoverageStore.getState().coverageFor(ID_A, persisted)?.heardRepeaters).toEqual([
      { nodeId: repeaterId, name: 'Rep Alpha', snr: undefined, rssi: undefined },
    ]);
  });

  it('renameMessageId keeps hops-only predicted coverage (no via) after pending→hash', () => {
    const pending = 'reticulum-pending-hops-only';
    const hash = 'dd'.repeat(32);
    addMessage(ID_A, { ...sampleRecord(pending), status: 'sending' });
    useRelayCoverageStore.getState().set(ID_A, pending, {
      protocol: 'reticulum',
      mode: 'predicted',
      predictedRelayHops: 2,
    });

    renameMessageId(ID_A, pending, hash);

    const coverage = useRelayCoverageStore.getState().coverageFor(ID_A, hash);
    expect(coverage?.predictedRelayHops).toBe(2);
    expect(coverage?.predictedFirstHop).toBeUndefined();
    expect(useRelayCoverageStore.getState().coverageFor(ID_A, pending)).toBeUndefined();
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

  it('renameMessageId onto acked Completes drops from coverage without touching to coverage', () => {
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
    useRelayCoverageStore.getState().set(ID_A, successHash, {
      protocol: 'reticulum',
      mode: 'predicted',
      predictedRelayHops: 1,
      predictedFirstHop: 'deadbeef',
    });
    useRelayCoverageStore.getState().set(ID_A, failedHash, {
      protocol: 'reticulum',
      mode: 'predicted',
      predictedRelayHops: 9,
      predictedFirstHop: 'badbad',
    });

    renameMessageId(ID_A, failedHash, successHash);

    expect(useRelayCoverageStore.getState().coverageFor(ID_A, failedHash)).toBeUndefined();
    expect(useRelayCoverageStore.getState().coverageFor(ID_A, successHash)).toMatchObject({
      predictedRelayHops: 1,
      predictedFirstHop: 'deadbeef',
    });
  });

  it('renameMessageId carries voice-memo attachment metadata onto an acked Completes target', () => {
    const successHash = 'aa'.repeat(32);
    const pending = 'reticulum-pending-voice-1';
    addMessage(ID_A, {
      ...sampleRecord(successHash),
      payload: '[voice:1200]',
      status: 'acked',
      timestamp: 2_000,
    });
    addMessage(ID_A, {
      ...sampleRecord(pending),
      payload: '[voice:1200]',
      status: 'sending',
      timestamp: 1_000,
      reticulumAttachmentPath: '/cache/memo.ogg',
      reticulumAttachmentKind: 'audio',
      reticulumAudioMode: 16,
      reticulumAudioDurationSec: 1.2,
    });

    renameMessageId(ID_A, pending, successHash);

    const bucket = useMessageStore.getState().messages[ID_A] ?? {};
    expect(bucket[pending]).toBeUndefined();
    expect(bucket[successHash]).toMatchObject({
      payload: '[voice:1200]',
      status: 'acked',
      reticulumAttachmentPath: '/cache/memo.ogg',
      reticulumAttachmentKind: 'audio',
      reticulumAudioMode: 16,
      reticulumAudioDurationSec: 1.2,
    });
  });

  it('renameMessageId carries audio mode and duration when target already has attachment path', () => {
    const successHash = 'aa'.repeat(32);
    const pending = 'reticulum-pending-voice-2';
    addMessage(ID_A, {
      ...sampleRecord(successHash),
      payload: '[voice:1200]',
      status: 'acked',
      timestamp: 2_000,
      reticulumAttachmentPath: '/cache/from-completes.ogg',
      reticulumAttachmentKind: 'audio',
    });
    addMessage(ID_A, {
      ...sampleRecord(pending),
      payload: '[voice:1200]',
      status: 'sending',
      timestamp: 1_000,
      reticulumAttachmentPath: '/cache/memo.ogg',
      reticulumAttachmentKind: 'audio',
      reticulumAudioMode: 16,
      reticulumAudioDurationSec: 1.2,
    });

    renameMessageId(ID_A, pending, successHash);

    const bucket = useMessageStore.getState().messages[ID_A] ?? {};
    expect(bucket[successHash]).toMatchObject({
      reticulumAttachmentPath: '/cache/from-completes.ogg',
      reticulumAudioMode: 16,
      reticulumAudioDurationSec: 1.2,
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
