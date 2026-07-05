import { describe, expect, it } from 'vitest';

import {
  meshcoreDirectRepeaterRelayPubKeys,
  meshcoreIsUsableTraceStoredPath,
  meshcoreShouldAbortMultiHopPingNoRoute,
  meshcoreStoredPathLooksLikeFullPubKey,
  meshcoreSynthesizeOneHopTracePath,
  meshcoreTraceDirectRetryEligible,
  planMeshcoreRepeaterTraceRoute,
} from './meshcoreRepeaterTracePath';

function makePubKey(firstByte = 0xab): Uint8Array {
  const key = new Uint8Array(32);
  key[0] = firstByte;
  key[1] = 0xcd;
  return key;
}

describe('meshcoreStoredPathLooksLikeFullPubKey', () => {
  it('detects a 32-byte path that matches the destination pubkey', () => {
    const pubKey = makePubKey();
    expect(meshcoreStoredPathLooksLikeFullPubKey(new Uint8Array(pubKey), pubKey)).toBe(true);
  });

  it('returns false for hash route segments', () => {
    const pubKey = makePubKey();
    expect(meshcoreStoredPathLooksLikeFullPubKey(new Uint8Array([0x11, 0x22]), pubKey)).toBe(false);
  });
});

describe('meshcoreIsUsableTraceStoredPath', () => {
  const pubKey = makePubKey();

  it('allows 1-byte prefix for 0-hop', () => {
    expect(meshcoreIsUsableTraceStoredPath(new Uint8Array([0xab]), 0, pubKey)).toBe(true);
  });

  it('allows full pubkey only for 0-hop (direct-retry send path)', () => {
    expect(meshcoreIsUsableTraceStoredPath(new Uint8Array(pubKey), 0, pubKey)).toBe(true);
    expect(meshcoreIsUsableTraceStoredPath(new Uint8Array(pubKey), 1, pubKey)).toBe(false);
  });

  it('rejects 32-byte paths for multi-hop even when bytes differ from pubkey', () => {
    const oddPath = Uint8Array.from({ length: 32 }, (_, i) => i);
    expect(meshcoreIsUsableTraceStoredPath(oddPath, 1, pubKey)).toBe(false);
  });
});

describe('planMeshcoreRepeaterTraceRoute', () => {
  const pubKey = makePubKey();

  it('0-hop: uses 1-byte stored prefix and skips route prime', () => {
    const plan = planMeshcoreRepeaterTraceRoute({
      storedPath: new Uint8Array([0xab]),
      hopsAway: 0,
      pubKey,
      radioContactPathLen: 0,
    });
    expect(plan.needsRoutePrime).toBe(false);
    expect(plan.pathTooShort).toBe(true);
    expect(plan.outPathSeed).toEqual(new Uint8Array([0xab]));
  });

  it('1-hop: rejects full pubkey in outPath map and requests route prime', () => {
    const plan = planMeshcoreRepeaterTraceRoute({
      storedPath: new Uint8Array(pubKey),
      hopsAway: 1,
      pubKey,
      radioContactPathLen: -1,
    });
    expect(plan.storedPath).toBeUndefined();
    expect(plan.needsRoutePrime).toBe(true);
    expect(plan.pathTooShort).toBe(true);
    expect(plan.uiSaysMultiHop).toBe(true);
    expect(plan.outPathSeed).toEqual(new Uint8Array([0xab]));
  });

  it('1-hop: uses 2-byte hash path from radio without priming', () => {
    const relayPath = new Uint8Array([0x11, 0x22]);
    const plan = planMeshcoreRepeaterTraceRoute({
      storedPath: relayPath,
      hopsAway: 1,
      pubKey,
      radioContactPathLen: 1,
    });
    expect(plan.needsRoutePrime).toBe(false);
    expect(plan.pathTooShort).toBe(false);
    expect(plan.outPathSeed).toEqual(relayPath);
  });

  it('1-hop: prefers path history when map holds invalid full pubkey', () => {
    const historyPath = new Uint8Array([0xaa, 0xbb]);
    const plan = planMeshcoreRepeaterTraceRoute({
      storedPath: new Uint8Array(pubKey),
      hopsAway: 1,
      pubKey,
      radioContactPathLen: null,
      pathFromHistory: historyPath,
    });
    expect(plan.storedPath).toEqual(historyPath);
    expect(plan.needsRoutePrime).toBe(false);
    expect(plan.outPathSeed).toEqual(historyPath);
  });
});

describe('meshcoreTraceDirectRetryEligible', () => {
  it('allows direct retry only for 0-hop with 1-byte seed path', () => {
    expect(meshcoreTraceDirectRetryEligible(0, 1)).toBe(true);
    expect(meshcoreTraceDirectRetryEligible(0, 32)).toBe(false);
    expect(meshcoreTraceDirectRetryEligible(1, 1)).toBe(false);
  });
});

describe('meshcoreShouldAbortMultiHopPingNoRoute', () => {
  it('aborts when radio confirms multi-hop but path bytes are missing', () => {
    expect(meshcoreShouldAbortMultiHopPingNoRoute(true, 1, true, true)).toBe(true);
  });

  it('does not abort for UI-only 1-hop (allows probe/synthesized trace)', () => {
    expect(meshcoreShouldAbortMultiHopPingNoRoute(true, 1, true, false)).toBe(false);
  });

  it('aborts for 2+ UI hops without path', () => {
    expect(meshcoreShouldAbortMultiHopPingNoRoute(true, 2, true, false)).toBe(true);
  });
});

describe('meshcoreSynthesizeOneHopTracePath', () => {
  it('builds [relayPrefix, destPrefix] from a direct repeater', () => {
    const relay = new Uint8Array(32);
    relay[0] = 0x06;
    const dest = new Uint8Array(32);
    dest[0] = 0x3d;
    expect(meshcoreSynthesizeOneHopTracePath(dest, [relay])).toEqual(new Uint8Array([0x06, 0x3d]));
  });
});

describe('meshcoreDirectRepeaterRelayPubKeys', () => {
  it('returns pubkeys for 0-hop repeaters only', () => {
    const relayKey = new Uint8Array(32);
    relayKey[0] = 0x06;
    const nodes = new Map([
      [1, { hops_away: 0, hw_model: 'Repeater' }],
      [2, { hops_away: 1, hw_model: 'Repeater' }],
      [3, { hops_away: 0, hw_model: 'Room' }],
    ]);
    const pubKeys = new Map([
      [1, relayKey],
      [2, new Uint8Array(32)],
      [3, new Uint8Array(32)],
    ]);
    expect(meshcoreDirectRepeaterRelayPubKeys(nodes, pubKeys, 99)).toEqual([relayKey]);
  });
});
