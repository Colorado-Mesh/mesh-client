import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRelayCoverageStore } from '@/renderer/lib/relayCoverage/relayCoverageStore';
import { meshcoreNodeHash } from '@/shared/meshcoreNodeHash';

import {
  clearHeardRepeatWindow,
  clearHeardRepeatWindowIfMessage,
  listMeshcorePathPrefixMatches,
  MESHCORE_HEARD_REPEAT_WINDOW_MS,
  openHeardRepeatWindow,
  recordMeshcoreRfRx,
  renameHeardRepeatWindowMessageId,
  resetHeardRepeatWindowsForTests,
  resolveMeshcoreHeardRepeaterFromNode,
} from './heardRepeatTracker';

const IDENTITY = 'mc-id-1';
const MSG_A = 'msg-a';
const MSG_B = 'msg-b';
/** Distinct XOR-fold hashes (1-byte path resolution). */
const MY_NODE = 0x01020304; // hash 0x04
const REPEATER_ID = 0x0a0b0c0d; // hash 0x0a^0x0b^0x0c^0x0d = 0x00
const ROOM_ID = 0x11223344; // hash 0x11^0x22^0x33^0x44 = 0x44
const CHAT_ID = 0x55667788; // hash 0x55^0x66^0x77^0x88 = 0xcc

function hashByte(nodeId: number): number {
  return meshcoreNodeHash(nodeId);
}

/** Self-origin prefix + relay hop hash bytes (1-byte path mode). */
function selfOriginPath(...relayHopHashes: number[]): number[] {
  return [hashByte(MY_NODE), ...relayHopHashes];
}

function resolveRepeater(nodeId: number) {
  if (nodeId === REPEATER_ID) return { nodeId, name: 'Rep Alpha' };
  if (nodeId === ROOM_ID) return { nodeId, name: 'Room Beta' };
  return null;
}

const candidates = [
  { node_id: MY_NODE, last_heard: 100 },
  { node_id: REPEATER_ID, last_heard: 200 },
  { node_id: ROOM_ID, last_heard: 150 },
  { node_id: CHAT_ID, last_heard: 180 },
];

describe('heardRepeatTracker', () => {
  beforeEach(() => {
    useRelayCoverageStore.setState({ coverage: {} });
    resetHeardRepeatWindowsForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    resetHeardRepeatWindowsForTests();
  });

  it('credits Repeater and ignores Chat role on self-originated RX', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      snr: 5.5,
      rssi: -80,
      candidates,
      resolveRepeater,
    });
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: [hashByte(CHAT_ID)],
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      snr: 1,
      candidates,
      resolveRepeater,
    });
    const heard = useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters;
    expect(heard).toEqual([{ nodeId: REPEATER_ID, name: 'Rep Alpha', snr: 5.5, rssi: -80 }]);
  });

  it('credits Room role the same as Repeater', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(hashByte(ROOM_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual([
      { nodeId: ROOM_ID, name: 'Room Beta', snr: undefined, rssi: undefined },
    ]);
  });

  it('ignores myNodeNum hash in the path', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: [hashByte(MY_NODE), hashByte(REPEATER_ID)],
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater: (id) =>
        id === MY_NODE || id === REPEATER_ID ? { nodeId: id, name: `n${id}` } : null,
    });
    const heard = useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters;
    expect(heard?.map((r) => r.nodeId)).toEqual([REPEATER_ID]);
  });

  it('dedupes by nodeId and can update SNR on later hear', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      snr: 2,
      candidates,
      resolveRepeater,
    });
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      snr: 8,
      candidates,
      resolveRepeater,
    });
    const heard = useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters;
    expect(heard).toHaveLength(1);
    expect(heard?.[0]?.snr).toBe(8);
  });

  it('ignores events after windowMs', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A, 1000);
    vi.advanceTimersByTime(1001);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual(
      [],
    );
  });

  it('clearHeardRepeatWindow drops the listen window so later RX cannot credit', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    clearHeardRepeatWindow(IDENTITY);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual(
      [],
    );
  });

  it('clearHeardRepeatWindowIfMessage only clears when message ids match', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    clearHeardRepeatWindowIfMessage(IDENTITY, MSG_B);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual([
      { nodeId: REPEATER_ID, name: 'Rep Alpha', snr: undefined, rssi: undefined },
    ]);
    clearHeardRepeatWindowIfMessage(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(hashByte(ROOM_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual([
      { nodeId: REPEATER_ID, name: 'Rep Alpha', snr: undefined, rssi: undefined },
    ]);
  });

  it('expired window is removed so a later open is a fresh listen', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A, 1000);
    vi.advanceTimersByTime(1001);
    openHeardRepeatWindow(IDENTITY, MSG_B, 5000);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual(
      [],
    );
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_B)?.heardRepeaters).toEqual([
      { nodeId: REPEATER_ID, name: 'Rep Alpha', snr: undefined, rssi: undefined },
    ]);
  });

  it('ignores non-self-originated events inside the window', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual(
      [],
    );
  });

  it('credits GRP_TXT channel-flood path hashes without cleartext self-origin', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual([
      { nodeId: REPEATER_ID, name: 'Rep Alpha' },
    ]);
  });

  it('treatAsOwnChannelFlood without an open window does not create coverage', () => {
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)).toBeUndefined();
  });

  it('treatAsOwnChannelFlood does not credit Chat path hops', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: selfOriginPath(hashByte(CHAT_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual(
      [],
    );
  });

  it('prefers Repeater over fresher Chat on 1-byte path hash collision', () => {
    const collideChat = 257; // same XOR hash as REPEATER_ID (0)
    expect(hashByte(collideChat)).toBe(hashByte(REPEATER_ID));
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates: [
        { node_id: collideChat, last_heard: 999 },
        { node_id: REPEATER_ID, last_heard: 1 },
        { node_id: MY_NODE, last_heard: 100 },
      ],
      resolveRepeater: (id) => (id === REPEATER_ID ? { nodeId: id, name: 'Rep Alpha' } : null),
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual([
      { nodeId: REPEATER_ID, name: 'Rep Alpha' },
    ]);
  });

  it('ignores unresolved relay path segments', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(0x99),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates: [],
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual(
      [],
    );
  });

  it('no-ops when no window is open', () => {
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)).toBeUndefined();
  });

  it('credits rapid successive TXs to the latest open message', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    vi.advanceTimersByTime(10);
    openHeardRepeatWindow(IDENTITY, MSG_B);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    // Superseded empty confirmed seed for MSG_A is removed when MSG_B window opens.
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)).toBeUndefined();
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_B)?.heardRepeaters).toEqual([
      { nodeId: REPEATER_ID, name: 'Rep Alpha', snr: undefined, rssi: undefined },
    ]);
  });

  it('openHeardRepeatWindow removes prior empty confirmed coverage for the same identity', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual(
      [],
    );
    openHeardRepeatWindow(IDENTITY, MSG_B);
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)).toBeUndefined();
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_B)?.heardRepeaters).toEqual(
      [],
    );
  });

  it('openHeardRepeatWindow keeps prior coverage that already credited repeaters', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    openHeardRepeatWindow(IDENTITY, MSG_B);
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual([
      { nodeId: REPEATER_ID, name: 'Rep Alpha', snr: undefined, rssi: undefined },
    ]);
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_B)?.heardRepeaters).toEqual(
      [],
    );
  });

  it('renameHeardRepeatWindowMessageId routes later credits to the new message id', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    useRelayCoverageStore.getState().renameMessage(IDENTITY, MSG_A, MSG_B);
    renameHeardRepeatWindowMessageId(IDENTITY, MSG_A, MSG_B);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)).toBeUndefined();
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_B)?.heardRepeaters).toEqual([
      { nodeId: REPEATER_ID, name: 'Rep Alpha', snr: undefined, rssi: undefined },
    ]);
  });

  it('resolves multibyte path segments via pubkey prefix', () => {
    const myPubKey = new Uint8Array(32);
    myPubKey[0] = 0x11;
    myPubKey[1] = 0x22;
    const repPubKey = new Uint8Array(32);
    repPubKey[0] = 0xab;
    repPubKey[1] = 0xcd;
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: [0x11, 0x22, 0xab, 0xcd],
      pathHashSizeBytes: 2,
      myNodeNum: MY_NODE,
      myPubKey,
      candidates: [{ node_id: REPEATER_ID, last_heard: 1 }],
      pubKeyByNodeId: new Map([[REPEATER_ID, repPubKey]]),
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual([
      { nodeId: REPEATER_ID, name: 'Rep Alpha', snr: undefined, rssi: undefined },
    ]);
  });

  it('empty pathBytes do not credit; single-hop paths do not credit', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: [],
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual(
      [],
    );
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: [hashByte(MY_NODE)],
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates: [],
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual(
      [],
    );
  });

  it('resolveMeshcoreHeardRepeaterFromNode filters by hw_model', () => {
    expect(
      resolveMeshcoreHeardRepeaterFromNode(1, {
        hw_model: 'Repeater',
        long_name: 'R',
      }),
    ).toEqual({ nodeId: 1, name: 'R' });
    expect(
      resolveMeshcoreHeardRepeaterFromNode(2, { hw_model: 'Chat', long_name: 'C' }),
    ).toBeNull();
  });

  it('credits all repeater relays after self-origin in a multi-hop path', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID), hashByte(ROOM_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    const heard = useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters;
    expect(heard?.map((r) => r.nodeId).sort()).toEqual([REPEATER_ID, ROOM_ID].sort());
  });

  it('credits repeater only when chat is also in the relay path', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID), hashByte(CHAT_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual([
      { nodeId: REPEATER_ID, name: 'Rep Alpha', snr: undefined, rssi: undefined },
    ]);
  });

  it('does not credit foreign-origin paths during an open window', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: [hashByte(CHAT_ID), hashByte(REPEATER_ID)],
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual(
      [],
    );
  });

  it('merges repeater credits from separate self-origin overhears', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(hashByte(ROOM_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    const heard = useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters;
    expect(heard?.map((r) => r.nodeId).sort()).toEqual([REPEATER_ID, ROOM_ID].sort());
  });

  it('listMeshcorePathPrefixMatches returns all 1-byte collisions freshest-first', () => {
    const collide = 257;
    const ids = listMeshcorePathPrefixMatches(Uint8Array.of(hashByte(REPEATER_ID)), [
      { node_id: collide, last_heard: 50 },
      { node_id: REPEATER_ID, last_heard: 10 },
    ]);
    expect(ids).toEqual([collide, REPEATER_ID]);
  });

  it('default window matches MESHCORE_HEARD_REPEAT_WINDOW_MS', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    vi.advanceTimersByTime(MESHCORE_HEARD_REPEAT_WINDOW_MS + 1);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: selfOriginPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual(
      [],
    );
  });
});
