// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { upsertMessage, useMessageStore } from '../stores/messageStore';
import {
  applyMeshcoreLateRfHopEnrichment,
  findMeshcoreLateRfHopEnrichmentTarget,
  isMeshcoreHopCorrected,
  markMeshcoreHopCorrected,
  type MeshcoreLateHopCandidate,
  resetMeshcoreHopCorrectedMarksForTests,
  shouldApplyMeshcoreRfHopEnrichment,
} from './meshcoreLateRfHopEnrichment';

const ID = 'meshcore:test-late-hops';

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

describe('shouldApplyMeshcoreRfHopEnrichment', () => {
  it('applies when hops are missing or disagree; ignores parseOk false', () => {
    expect(shouldApplyMeshcoreRfHopEnrichment(undefined, 2, true)).toBe(true);
    expect(shouldApplyMeshcoreRfHopEnrichment(1, 2, true)).toBe(true);
    expect(shouldApplyMeshcoreRfHopEnrichment(2, 2, true)).toBe(false);
    expect(shouldApplyMeshcoreRfHopEnrichment(undefined, 2, false)).toBe(false);
  });
});

describe('findMeshcoreLateRfHopEnrichmentTarget', () => {
  const now = 1_700_000_000_000;

  it('prefers fingerprint match over window heuristic', () => {
    const candidates = [
      candidate({
        storeId: 'window',
        timestamp: now - 100,
        rxHops: undefined,
      }),
      candidate({
        storeId: 'fp',
        timestamp: now - 2500,
        rxHops: undefined,
        rxPacketFingerprintHex: 'AABBCCDD',
      }),
    ];
    const hit = findMeshcoreLateRfHopEnrichmentTarget(candidates, {
      payloadTypeString: 'GRP_TXT',
      hopCount: 3,
      fromNodeId: null,
      messageFingerprintHex: 'aabbccdd',
      parseOk: true,
      now,
    });
    expect(hit?.storeId).toBe('fp');
  });

  it('selects most recent channel message needing hops', () => {
    const candidates = [
      candidate({ storeId: 'old', timestamp: now - 2000, rxHops: undefined }),
      candidate({ storeId: 'new', timestamp: now - 100, rxHops: undefined }),
    ];
    const hit = findMeshcoreLateRfHopEnrichmentTarget(candidates, {
      payloadTypeString: 'GRP_TXT',
      hopCount: 2,
      fromNodeId: null,
      messageFingerprintHex: null,
      parseOk: true,
      now,
    });
    expect(hit?.storeId).toBe('new');
  });

  it('prefers DM sender matching fromNodeId', () => {
    const candidates = [
      candidate({
        storeId: 'other',
        channel: -1,
        sender_id: 0x111,
        timestamp: now - 50,
        rxHops: undefined,
      }),
      candidate({
        storeId: 'match',
        channel: -1,
        sender_id: 0xabc,
        timestamp: now - 200,
        rxHops: undefined,
      }),
    ];
    const hit = findMeshcoreLateRfHopEnrichmentTarget(candidates, {
      payloadTypeString: 'TXT_MSG',
      hopCount: 1,
      fromNodeId: 0xabc,
      messageFingerprintHex: null,
      parseOk: true,
      now,
    });
    expect(hit?.storeId).toBe('match');
  });

  it('skips candidates that already have the same hop count', () => {
    const candidates = [candidate({ storeId: 'same', timestamp: now - 100, rxHops: 2 })];
    expect(
      findMeshcoreLateRfHopEnrichmentTarget(candidates, {
        payloadTypeString: 'GRP_TXT',
        hopCount: 2,
        fromNodeId: null,
        messageFingerprintHex: null,
        parseOk: true,
        now,
      }),
    ).toBeUndefined();
  });

  it('ignores parseOk false', () => {
    const candidates = [candidate({ storeId: 'a', timestamp: now - 100, rxHops: undefined })];
    expect(
      findMeshcoreLateRfHopEnrichmentTarget(candidates, {
        payloadTypeString: 'GRP_TXT',
        hopCount: 1,
        fromNodeId: null,
        messageFingerprintHex: null,
        parseOk: false,
        now,
      }),
    ).toBeUndefined();
  });
});

describe('applyMeshcoreLateRfHopEnrichment', () => {
  const saveMeshcoreMessage = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    resetMeshcoreHopCorrectedMarksForTests();
    vi.spyOn(window.electronAPI.db, 'saveMeshcoreMessage').mockImplementation(saveMeshcoreMessage);
    saveMeshcoreMessage.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetMeshcoreHopCorrectedMarksForTests();
  });

  it('fills missing hops without marking corrected', () => {
    const now = Date.now();
    upsertMessage(ID, {
      id: 'ch:0:1:hi',
      from: 0xabc,
      to: 0xffffffff,
      payload: 'hi',
      channelIndex: 0,
      timestamp: now,
      receivedVia: 'rf',
    });
    const result = applyMeshcoreLateRfHopEnrichment(ID, {
      payloadTypeString: 'GRP_TXT',
      hopCount: 3,
      fromNodeId: 0xabc,
      messageFingerprintHex: null,
      parseOk: true,
      now,
      myNodeNum: 1,
    });
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
    upsertMessage(ID, {
      id: 'ch:0:2:hi',
      from: 0xabc,
      to: 0xffffffff,
      payload: 'hi',
      channelIndex: 0,
      timestamp: now,
      receivedVia: 'rf',
      rxHops: 1,
      hopCount: 1,
    });
    const result = applyMeshcoreLateRfHopEnrichment(ID, {
      payloadTypeString: 'GRP_TXT',
      hopCount: 4,
      fromNodeId: 0xabc,
      messageFingerprintHex: null,
      parseOk: true,
      now,
      myNodeNum: 1,
    });
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
    upsertMessage(ID, {
      id: 'ch:0:3:hi',
      from: 0xabc,
      to: 0xffffffff,
      payload: 'hi',
      channelIndex: 0,
      timestamp: now,
      receivedVia: 'rf',
      rxHops: 2,
    });
    expect(
      applyMeshcoreLateRfHopEnrichment(ID, {
        payloadTypeString: 'GRP_TXT',
        hopCount: 2,
        fromNodeId: null,
        messageFingerprintHex: null,
        parseOk: true,
        now,
        myNodeNum: 1,
      }),
    ).toBeNull();
    expect(saveMeshcoreMessage).not.toHaveBeenCalled();
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
