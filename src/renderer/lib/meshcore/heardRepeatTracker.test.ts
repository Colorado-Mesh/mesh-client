import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRelayCoverageStore } from '@/renderer/lib/relayCoverage/relayCoverageStore';
import { encodeMeshcoreGroupText } from '@/shared/meshcoreGroupText';
import { meshcoreNodeHash } from '@/shared/meshcoreNodeHash';
import { meshCorePathInvariantPayloadId } from '@/shared/meshcoreRfPacketParse';

import {
  clearHeardRepeatWindow,
  clearHeardRepeatWindowIfMessage,
  isSyntheticHeardNodeId,
  listMeshcorePathPrefixMatches,
  MESHCORE_HEARD_REPEAT_WINDOW_MS,
  openHeardRepeatWindow,
  recordMeshcoreRfRx,
  renameHeardRepeatWindowMessageId,
  resetHeardRepeatWindowsForTests,
  resolveMeshcoreHeardRepeaterFromNode,
  setMeshcoreHeardRepeatChannelSecrets,
} from './heardRepeatTracker';

const IDENTITY = 'mc-id-1';
const MSG_A = 'msg-a';
const MSG_B = 'msg-b';
/** Distinct XOR-fold hashes (1-byte path resolution). */
const MY_NODE = 0x01020304; // hash 0x04

function payloadId(tag: string) {
  return meshCorePathInvariantPayloadId(5, new TextEncoder().encode(tag));
}

const GRP_TXT_NIBBLE = 5;
const CHANNEL_IDX = 3;
const CHANNEL_SECRET = Uint8Array.from({ length: 16 }, (_, i) => 0x20 + i);
const SENDER_NAME = 'N4CNR Heltec V4';
const SENT_AT_SEC = Math.floor(Date.parse('2026-06-01T12:00:00.000Z') / 1000);

function grpTxtId(text: string, timestampSec = SENT_AT_SEC, secret = CHANNEL_SECRET) {
  return meshCorePathInvariantPayloadId(
    GRP_TXT_NIBBLE,
    encodeMeshcoreGroupText(secret, timestampSec, text),
  );
}

/** Our own channel flood as repeaters rebroadcast it. */
const OWN_GRP_TXT = () => grpTxtId(`${SENDER_NAME}: Test`);

/** Open a window that expects our own `"N4CNR Heltec V4: Test"` on CHANNEL_IDX. */
function openOwnChannelWindow(messageId: string): void {
  setMeshcoreHeardRepeatChannelSecrets([{ index: CHANNEL_IDX, secret: CHANNEL_SECRET }]);
  openHeardRepeatWindow(IDENTITY, messageId, undefined, undefined, {
    channelIndex: CHANNEL_IDX,
    senderName: SENDER_NAME,
    wireText: 'Test',
    sentAtSec: SENT_AT_SEC,
  });
}

const REPEATER_ID = 0x0a0b0c0d; // hash 0x0a^0x0b^0x0c^0x0d = 0x00
const ROOM_ID = 0x11223344; // hash 0x11^0x22^0x33^0x44 = 0x44
const CHAT_ID = 0x55667788; // hash 0x55^0x66^0x77^0x88 = 0xcc

function hashByte(nodeId: number): number {
  return meshcoreNodeHash(nodeId);
}

/** Flood path of forwarder hashes only (1-byte path mode; originator is never in path). */
function floodPath(...relayHopHashes: number[]): number[] {
  return [...relayHopHashes];
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
      pathBytes: floodPath(hashByte(REPEATER_ID)),
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
      pathBytes: floodPath(hashByte(ROOM_ID)),
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
      pathBytes: floodPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      snr: 2,
      candidates,
      resolveRepeater,
    });
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: floodPath(hashByte(REPEATER_ID)),
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
      pathBytes: floodPath(hashByte(REPEATER_ID)),
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
      pathBytes: floodPath(hashByte(REPEATER_ID)),
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
      pathBytes: floodPath(hashByte(REPEATER_ID)),
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
      pathBytes: floodPath(hashByte(ROOM_ID)),
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
      pathBytes: floodPath(hashByte(REPEATER_ID)),
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
      pathBytes: floodPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual(
      [],
    );
  });

  it('credits GRP_TXT forwarders when the flood decrypts to our own message', () => {
    openOwnChannelWindow(MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: floodPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      payloadIdentity: OWN_GRP_TXT(),
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual([
      { nodeId: REPEATER_ID, name: 'Rep Alpha' },
    ]);
  });

  it('does not credit foreign channel traffic while the window is unconfirmed', () => {
    openOwnChannelWindow(MSG_A);
    const foreign = [
      grpTxtId('Curt ~ 1114: Test'),
      grpTxtId(
        `${SENDER_NAME}: Test`,
        SENT_AT_SEC,
        Uint8Array.from({ length: 16 }, () => 7),
      ),
      grpTxtId(`${SENDER_NAME}: Test`, SENT_AT_SEC - 60),
      grpTxtId(`${SENDER_NAME}: other text`),
      payloadId('NOTGRPTXT'),
    ];
    for (const payloadIdentity of foreign) {
      recordMeshcoreRfRx({
        identityId: IDENTITY,
        isOwnMeshcoreTx: false,
        treatAsOwnChannelFlood: true,
        pathBytes: floodPath(hashByte(REPEATER_ID)),
        pathHashSizeBytes: 1,
        myNodeNum: MY_NODE,
        payloadIdentity,
        candidates,
        resolveRepeater,
      });
    }
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual(
      [],
    );
  });

  it('does not credit GRP_TXT when the window has no expectation', () => {
    setMeshcoreHeardRepeatChannelSecrets([{ index: CHANNEL_IDX, secret: CHANNEL_SECRET }]);
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: floodPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      payloadIdentity: OWN_GRP_TXT(),
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual(
      [],
    );
  });

  it('does not credit GRP_TXT when the channel secret is unknown', () => {
    openOwnChannelWindow(MSG_A);
    setMeshcoreHeardRepeatChannelSecrets([]);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: floodPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      payloadIdentity: OWN_GRP_TXT(),
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual(
      [],
    );
  });

  it('accepts a send timestamp one second after the recorded send time', () => {
    openOwnChannelWindow(MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: floodPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      payloadIdentity: grpTxtId(`${SENDER_NAME}: Test`, SENT_AT_SEC + 1),
      candidates,
      resolveRepeater,
    });
    expect(
      useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters,
    ).toHaveLength(1);
  });

  it('treatAsOwnChannelFlood without an open window does not create coverage', () => {
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: floodPath(hashByte(REPEATER_ID)),
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
      pathBytes: floodPath(hashByte(CHAT_ID)),
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
    openOwnChannelWindow(MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: floodPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      payloadIdentity: OWN_GRP_TXT(),
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

  it('ignores unresolved Chat matches but credits unresolved flood path hashes as hex', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: floodPath(0x99),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates: [],
      resolveRepeater,
    });
    const heard = useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters;
    expect(heard).toHaveLength(1);
    expect(heard?.[0]?.name).toBe('99');
  });

  it('no-ops when no window is open', () => {
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: floodPath(hashByte(REPEATER_ID)),
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
      pathBytes: floodPath(hashByte(REPEATER_ID)),
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
      pathBytes: floodPath(hashByte(REPEATER_ID)),
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
      pathBytes: floodPath(hashByte(REPEATER_ID)),
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

  it('empty pathBytes do not credit; self-only path does not credit; single repeater hop does', () => {
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
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: floodPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual([
      { nodeId: REPEATER_ID, name: 'Rep Alpha', snr: undefined, rssi: undefined },
    ]);
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

  it('credits all repeater relays in a multi-hop flood path', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: floodPath(hashByte(REPEATER_ID), hashByte(ROOM_ID)),
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
      pathBytes: floodPath(hashByte(REPEATER_ID), hashByte(CHAT_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual([
      { nodeId: REPEATER_ID, name: 'Rep Alpha', snr: undefined, rssi: undefined },
    ]);
  });

  it('credits Repeater but not Chat when Chat appears first in the flood path', () => {
    openOwnChannelWindow(MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: [hashByte(CHAT_ID), hashByte(REPEATER_ID)],
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      payloadIdentity: OWN_GRP_TXT(),
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual([
      { nodeId: REPEATER_ID, name: 'Rep Alpha' },
    ]);
  });

  it('rejects foreign payload identity once the window is bound from own TX', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: [],
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      payloadIdentity: payloadId('AAAAAAAA'),
      candidates,
      resolveRepeater,
    });
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: floodPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      payloadIdentity: payloadId('BBBBBBBB'),
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual(
      [],
    );
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: floodPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      payloadIdentity: payloadId('AAAAAAAA'),
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual([
      { nodeId: REPEATER_ID, name: 'Rep Alpha' },
    ]);
  });

  it('merges repeater credits from separate self-origin overhears', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: floodPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: floodPath(hashByte(ROOM_ID)),
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
      pathBytes: floodPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual(
      [],
    );
  });

  it('credits only our flood when foreign channel traffic arrives first, then later repeats', () => {
    openOwnChannelWindow(MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: floodPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      payloadIdentity: grpTxtId('Curt ~ 1114: Test'),
      candidates,
      resolveRepeater,
    });
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: floodPath(hashByte(ROOM_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      payloadIdentity: OWN_GRP_TXT(),
      candidates,
      resolveRepeater,
    });
    // A later repeat of the same payload via another forwarder is also credited.
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: floodPath(hashByte(ROOM_ID), hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      payloadIdentity: OWN_GRP_TXT(),
      candidates,
      resolveRepeater,
    });
    const heard = useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters;
    expect(heard?.map((r) => r.nodeId).sort()).toEqual([REPEATER_ID, ROOM_ID].sort());
  });

  it('credits multi-hop path as multiple named forwarders', () => {
    openOwnChannelWindow(MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: floodPath(hashByte(REPEATER_ID), hashByte(ROOM_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      payloadIdentity: OWN_GRP_TXT(),
      candidates,
      resolveRepeater,
    });
    const heard = useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters;
    expect(heard?.map((r) => r.nodeId).sort()).toEqual([REPEATER_ID, ROOM_ID].sort());
  });

  it('isSyntheticHeardNodeId detects unresolved forwarder credits', () => {
    openHeardRepeatWindow(IDENTITY, MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: true,
      pathBytes: floodPath(0xab),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      candidates: [],
      resolveRepeater,
    });
    const heard = useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters;
    expect(heard).toHaveLength(1);
    expect(heard?.[0]?.name).toBe('ab');
    expect(isSyntheticHeardNodeId(heard![0].nodeId)).toBe(true);
    expect(isSyntheticHeardNodeId(REPEATER_ID)).toBe(false);
  });

  it('does not treat unsigned high-bit real node ids as synthetic', () => {
    const highBitReal = 0x80000001 >>> 0;
    expect(highBitReal).toBeGreaterThan(0);
    expect(isSyntheticHeardNodeId(highBitReal)).toBe(false);
    expect(isSyntheticHeardNodeId(-1)).toBe(true);
  });

  it('does not bind payload identity from a foreign empty-path channel flood', () => {
    openOwnChannelWindow(MSG_A);
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: [],
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      payloadIdentity: payloadId('EMPTYPATH'),
      candidates,
      resolveRepeater,
    });
    recordMeshcoreRfRx({
      identityId: IDENTITY,
      isOwnMeshcoreTx: false,
      treatAsOwnChannelFlood: true,
      pathBytes: floodPath(hashByte(REPEATER_ID)),
      pathHashSizeBytes: 1,
      myNodeNum: MY_NODE,
      payloadIdentity: payloadId('OTHERFLOD'),
      candidates,
      resolveRepeater,
    });
    expect(useRelayCoverageStore.getState().coverageFor(IDENTITY, MSG_A)?.heardRepeaters).toEqual(
      [],
    );
  });
});
