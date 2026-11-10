// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encodeMeshcoreGroupText } from '@/shared/meshcoreGroupText';

import { upsertMessage, useMessageStore } from '../stores/messageStore';
import {
  applyMeshcoreLateRfHopEnrichment,
  decodeMeshcoreLateHopGroupText,
  findMeshcoreLateRfHopEnrichmentTarget,
  isMeshcoreHopCorrected,
  markMeshcoreHopCorrected,
  type MeshcoreLateHopCandidate,
  type MeshcoreLateHopGroupText,
  type MeshcoreLateRfHopEnrichmentInput,
  resetMeshcoreHopCorrectedMarksForTests,
  resetMeshcoreLateHopSeenPacketsForTests,
  shouldApplyMeshcoreRfHopEnrichment,
} from './meshcoreLateRfHopEnrichment';

const ID = 'meshcore:test-late-hops';
const OTHER_ID = 'meshcore:test-late-hops-other';

function candidate(
  partial: Partial<MeshcoreLateHopCandidate> & Pick<MeshcoreLateHopCandidate, 'storeId'>,
): MeshcoreLateHopCandidate {
  return {
    sender_id: 0xabc,
    channel: 0,
    timestamp: Date.now(),
    receivedVia: 'rf',
    ...partial,
  };
}

function groupText(
  senderName: string,
  payload: string,
  timestampMs: number,
  channel = 0,
): MeshcoreLateHopGroupText {
  return {
    channel,
    timestampSec: Math.floor(timestampMs / 1000),
    rawText: `${senderName}: ${payload}`,
    senderName,
    payload,
  };
}

function channelRow(
  storeId: string,
  senderName: string,
  payload: string,
  timestamp: number,
  extra: Partial<MeshcoreLateHopCandidate> = {},
): MeshcoreLateHopCandidate {
  return candidate({
    storeId,
    timestamp,
    sender_name: senderName,
    payload,
    meshcoreDedupeKey: `${senderName}: ${payload}`,
    ...extra,
  });
}

function grpInput(
  hopCount: number,
  text: MeshcoreLateHopGroupText | undefined,
  now: number,
): MeshcoreLateRfHopEnrichmentInput {
  return {
    payloadTypeString: 'GRP_TXT',
    hopCount,
    messageFingerprintHex: null,
    parseOk: true,
    now,
    ...(text ? { groupText: text } : {}),
  };
}

describe('shouldApplyMeshcoreRfHopEnrichment', () => {
  it('applies when hops are missing or disagree; ignores parseOk false', () => {
    expect(shouldApplyMeshcoreRfHopEnrichment(undefined, 2, true)).toBe(true);
    expect(shouldApplyMeshcoreRfHopEnrichment(1, 2, true)).toBe(true);
    expect(shouldApplyMeshcoreRfHopEnrichment(2, 2, true)).toBe(false);
    expect(shouldApplyMeshcoreRfHopEnrichment(undefined, 2, false)).toBe(false);
  });
});

describe('decodeMeshcoreLateHopGroupText', () => {
  const secret0 = new Uint8Array(16).fill(1);
  const secret3 = new Uint8Array(16).fill(7);

  it('decodes the packet with the channel key that opens it', () => {
    const inner = encodeMeshcoreGroupText(secret3, 1_700_000_123, 'AlexT1000: on my way');
    const decoded = decodeMeshcoreLateHopGroupText(
      inner,
      new Map([
        [0, secret0],
        [3, secret3],
      ]),
    );
    expect(decoded).toEqual({
      channel: 3,
      timestampSec: 1_700_000_123,
      rawText: 'AlexT1000: on my way',
      senderName: 'AlexT1000',
      payload: 'on my way',
    });
  });

  it('returns null when no configured channel key opens the packet', () => {
    const inner = encodeMeshcoreGroupText(new Uint8Array(16).fill(9), 1_700_000_123, 'X: hi');
    expect(decodeMeshcoreLateHopGroupText(inner, new Map([[0, secret0]]))).toBeNull();
  });
});

describe('findMeshcoreLateRfHopEnrichmentTarget', () => {
  const now = 1_700_000_000_000;

  it('prefers fingerprint match over content', () => {
    const candidates = [
      channelRow('content', 'AlexT1000', 'hi', now - 100),
      candidate({
        storeId: 'fp',
        timestamp: now - 2500,
        rxHops: undefined,
        rxPacketFingerprintHex: 'AABBCCDD',
      }),
    ];
    const hit = findMeshcoreLateRfHopEnrichmentTarget(candidates, {
      ...grpInput(3, groupText('AlexT1000', 'hi', now - 100), now),
      messageFingerprintHex: 'aabbccdd',
    });
    expect(hit?.storeId).toBe('fp');
  });

  it('patches the channel row the packet decodes to, not the newest row', () => {
    const candidates = [
      channelRow('alex', 'AlexT1000', 'text A', now - 1000),
      channelRow('golden', 'Golden Hut', 'text B', now - 50),
    ];
    const hit = findMeshcoreLateRfHopEnrichmentTarget(
      candidates,
      grpInput(3, groupText('AlexT1000', 'text A', now - 1000), now),
    );
    expect(hit?.storeId).toBe('alex');
  });

  it('leaves the previous message alone when the next packet arrives before its own message', () => {
    // RX log for packet B lands while only message A is stored (the radio logs before it delivers).
    const candidates = [channelRow('alex', 'AlexT1000', 'text A', now - 1000, { rxHops: 3 })];
    expect(
      findMeshcoreLateRfHopEnrichmentTarget(
        candidates,
        grpInput(2, groupText('Golden Hut', 'text B', now), now),
      ),
    ).toBeUndefined();
  });

  it('patches nothing for a channel packet it could not decrypt', () => {
    const candidates = [channelRow('recent', 'AlexT1000', 'hi', now - 100)];
    expect(
      findMeshcoreLateRfHopEnrichmentTarget(candidates, grpInput(2, undefined, now)),
    ).toBeUndefined();
  });

  it('matches the raw wire text when the stored sender name differs', () => {
    const candidates = [
      channelRow('nick', 'Alex (truck)', 'hi', now - 100, {
        meshcoreDedupeKey: 'AlexT1000: hi',
      }),
    ];
    const hit = findMeshcoreLateRfHopEnrichmentTarget(
      candidates,
      grpInput(2, groupText('AlexT1000', 'hi', now - 100), now),
    );
    expect(hit?.storeId).toBe('nick');
  });

  it('matches by sender and text when the row has no wire text (reloaded history)', () => {
    const candidates = [
      channelRow('reloaded', 'AlexT1000', 'hi', now - 100, { meshcoreDedupeKey: undefined }),
    ];
    const hit = findMeshcoreLateRfHopEnrichmentTarget(
      candidates,
      grpInput(2, groupText('AlexT1000', 'hi', now - 100), now),
    );
    expect(hit?.storeId).toBe('reloaded');
  });

  it('matches a row stored at receive time when the sender clock is ahead', () => {
    // effectiveMessageTimestampMs stores receive time for wire times more than 5 min ahead.
    const ahead = now + 3_600_000;
    const candidates = [channelRow('ahead', 'AlexT1000', 'hi', now - 400)];
    const hit = findMeshcoreLateRfHopEnrichmentTarget(
      candidates,
      grpInput(2, groupText('AlexT1000', 'hi', ahead), now),
    );
    expect(hit?.storeId).toBe('ahead');
  });

  it('does not match an old row with the same text when the sender clock is ahead', () => {
    const ahead = now + 3_600_000;
    const candidates = [channelRow('old', 'AlexT1000', 'hi', now - 60_000)];
    expect(
      findMeshcoreLateRfHopEnrichmentTarget(
        candidates,
        grpInput(2, groupText('AlexT1000', 'hi', ahead), now),
      ),
    ).toBeUndefined();
  });

  it('does not match a different second, another channel, an own row or an equal count', () => {
    const text = groupText('AlexT1000', 'hi', now - 100);
    const rows = [
      channelRow('other-second', 'AlexT1000', 'hi', now - 2100),
      channelRow('other-channel', 'AlexT1000', 'hi', now - 100, { channel: 1 }),
      channelRow('own', 'AlexT1000', 'hi', now - 100, { sender_id: 0x1 }),
      channelRow('same-count', 'AlexT1000', 'hi', now - 100, { sender_id: 0x2, rxHops: 2 }),
    ];
    for (const row of rows) {
      expect(
        findMeshcoreLateRfHopEnrichmentTarget([row], { ...grpInput(2, text, now), myNodeNum: 0x1 }),
      ).toBeUndefined();
    }
  });

  it('patches no DM row by sender and time, with or without a count', () => {
    // The radio logs a DM before it delivers it (MeshCore Dispatcher::checkRecv), so the newest
    // stored DM from the sender is always an earlier message or the one this packet retries.
    const candidates = [
      candidate({ storeId: 'counted', channel: -1, timestamp: now - 100, rxHops: 2 }),
      candidate({ storeId: 'uncounted', channel: -1, timestamp: now - 200, rxHops: undefined }),
    ];
    expect(
      findMeshcoreLateRfHopEnrichmentTarget(candidates, {
        payloadTypeString: 'TXT_MSG',
        hopCount: 4,
        messageFingerprintHex: null,
        parseOk: true,
        now,
      }),
    ).toBeUndefined();
  });

  it('still patches a DM row whose stored packet fingerprint matches', () => {
    const candidates = [
      candidate({
        storeId: 'fingerprinted',
        channel: -1,
        timestamp: now - 100,
        rxHops: 2,
        rxPacketFingerprintHex: 'AABBCCDD',
      }),
    ];
    const hit = findMeshcoreLateRfHopEnrichmentTarget(candidates, {
      payloadTypeString: 'TXT_MSG',
      hopCount: 4,
      messageFingerprintHex: 'aabbccdd',
      parseOk: true,
      now,
    });
    expect(hit?.storeId).toBe('fingerprinted');
  });

  it('ignores parseOk false', () => {
    const candidates = [channelRow('a', 'AlexT1000', 'hi', now - 100)];
    expect(
      findMeshcoreLateRfHopEnrichmentTarget(candidates, {
        ...grpInput(1, groupText('AlexT1000', 'hi', now - 100), now),
        parseOk: false,
      }),
    ).toBeUndefined();
  });
});

describe('applyMeshcoreLateRfHopEnrichment', () => {
  const saveMeshcoreMessage = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    resetMeshcoreHopCorrectedMarksForTests();
    resetMeshcoreLateHopSeenPacketsForTests();
    vi.spyOn(window.electronAPI.db, 'saveMeshcoreMessage').mockImplementation(saveMeshcoreMessage);
    saveMeshcoreMessage.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetMeshcoreHopCorrectedMarksForTests();
    resetMeshcoreLateHopSeenPacketsForTests();
  });

  function storeChannelRow(
    identityId: string,
    id: string,
    now: number,
    rxHops?: number,
    receivedVia: 'rf' | 'mqtt' = 'rf',
  ): void {
    upsertMessage(identityId, {
      id,
      from: 0xabc,
      senderName: 'AlexT1000',
      to: 0xffffffff,
      payload: 'hi',
      channelIndex: 0,
      timestamp: now,
      receivedVia,
      meshcoreDedupeKey: 'AlexT1000: hi',
      ...(rxHops != null ? { rxHops, hopCount: rxHops } : {}),
    });
  }

  function grpApply(identityId: string, hopCount: number, now: number, payloadIdHex?: string) {
    return applyMeshcoreLateRfHopEnrichment(identityId, {
      ...grpInput(hopCount, groupText('AlexT1000', 'hi', now), now),
      myNodeNum: 1,
      ...(payloadIdHex ? { payloadIdHex } : {}),
    });
  }

  it('fills missing hops without marking corrected', () => {
    const now = Date.now();
    storeChannelRow(ID, 'ch:0:1:hi', now);
    const result = grpApply(ID, 3, now);
    expect(result).toMatchObject({
      storeId: 'ch:0:1:hi',
      previousRxHops: undefined,
      nextRxHops: 3,
      corrected: false,
    });
    expect(isMeshcoreHopCorrected('ch:0:1:hi')).toBe(false);
    expect(useMessageStore.getState().messages[ID]['ch:0:1:hi'].rxHops).toBe(3);
    expect(saveMeshcoreMessage).toHaveBeenCalled();
  });

  it('replaces disagreeing hops and marks corrected', () => {
    const now = Date.now();
    storeChannelRow(ID, 'ch:0:2:hi', now, 1);
    const result = grpApply(ID, 4, now);
    expect(result).toMatchObject({
      previousRxHops: 1,
      nextRxHops: 4,
      corrected: true,
    });
    expect(isMeshcoreHopCorrected('ch:0:2:hi')).toBe(true);
    expect(useMessageStore.getState().messages[ID]['ch:0:2:hi'].rxHops).toBe(4);
  });

  it('no-ops when hops already match', () => {
    const now = Date.now();
    storeChannelRow(ID, 'ch:0:3:hi', now, 2);
    expect(grpApply(ID, 2, now)).toBeNull();
    expect(saveMeshcoreMessage).not.toHaveBeenCalled();
  });

  it('takes only the first reception of a packet', () => {
    const now = Date.now();
    storeChannelRow(ID, 'ch:0:4:hi', now, 1, 'mqtt');
    expect(grpApply(ID, 3, now, 'AAAA0001')).toMatchObject({ nextRxHops: 3 });
    expect(useMessageStore.getState().messages[ID]['ch:0:4:hi'].receivedVia).toBe('both');
    // A repeat of the same packet over a longer path must not replace the first count.
    expect(grpApply(ID, 5, now, 'AAAA0001')).toBeNull();
    expect(useMessageStore.getState().messages[ID]['ch:0:4:hi'].rxHops).toBe(3);
  });

  it('ignores repeats of a packet first heard before its message was stored', () => {
    const now = Date.now();
    // The radio logs the first reception, then delivers the message with that reception's count.
    expect(grpApply(ID, 2, now, 'AAAA0002')).toBeNull();
    storeChannelRow(ID, 'ch:0:5:hi', now, 2);
    expect(grpApply(ID, 4, now, 'AAAA0002')).toBeNull();
    expect(useMessageStore.getState().messages[ID]['ch:0:5:hi'].rxHops).toBe(2);
    expect(saveMeshcoreMessage).not.toHaveBeenCalled();
  });

  it('ignores repeats of a DM packet over a longer path', () => {
    const now = Date.now();
    upsertMessage(ID, {
      id: 'dm:abc:1',
      from: 0xabc,
      senderName: 'AlexT1000',
      to: 1,
      payload: 'hello',
      channelIndex: -1,
      timestamp: now,
      receivedVia: 'rf',
      rxHops: 2,
      hopCount: 2,
    });
    const dm = (hopCount: number) =>
      applyMeshcoreLateRfHopEnrichment(ID, {
        payloadTypeString: 'TXT_MSG',
        hopCount,
        messageFingerprintHex: null,
        parseOk: true,
        now,
        myNodeNum: 1,
        payloadIdHex: 'BBBB0001',
      });
    expect(dm(2)).toBeNull();
    expect(dm(4)).toBeNull();
    expect(useMessageStore.getState().messages[ID]['dm:abc:1'].rxHops).toBe(2);
  });

  it('tracks first receptions per connection', () => {
    const now = Date.now();
    storeChannelRow(ID, 'ch:0:6:hi', now, 1);
    storeChannelRow(OTHER_ID, 'ch:0:6:hi', now, 1);
    expect(grpApply(ID, 3, now, 'AAAA0003')).toMatchObject({ nextRxHops: 3 });
    expect(grpApply(OTHER_ID, 3, now, 'AAAA0003')).toMatchObject({ nextRxHops: 3 });
  });
});

describe('markMeshcoreHopCorrected', () => {
  afterEach(() => {
    resetMeshcoreHopCorrectedMarksForTests();
  });

  it('expires after TTL', () => {
    const t0 = 1_000_000;
    markMeshcoreHopCorrected('msg-1', t0, 50);
    expect(isMeshcoreHopCorrected('msg-1', t0 + 10)).toBe(true);
    expect(isMeshcoreHopCorrected('msg-1', t0 + 60)).toBe(false);
  });
});
