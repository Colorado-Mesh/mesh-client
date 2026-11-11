import { describe, expect, it } from 'vitest';

import {
  computeMeshcoreTracePrimeStrategy,
  evaluateMeshcorePingRouteAbort,
  MESHCORE_CLI_PREEMPT_TRACE_REASON,
  meshcoreDirectRepeaterRelayPubKeys,
  meshcoreExpandTracePathWithAutoReturn,
  meshcoreHashSizeForTraceSeed,
  meshcoreIsUsableTraceStoredPath,
  meshcoreRadioContactPathLenSaysMultiHop,
  meshcoreShouldAbortMultiHopPingNoRoute,
  meshcoreStoredPathLooksLikeFullPubKey,
  meshcoreSynthesizeMultiHopTracePath,
  meshcoreSynthesizeOneHopTracePath,
  meshcoreTraceCancelledForCliPreempt,
  meshcoreTraceDirectRetryEligible,
  meshcoreTraceOutboundFromStoredPath,
  meshcoreTraceOutboundLegOfRoundTrip,
  meshcoreTraceStoredPathFromOutbound,
  planMeshcoreRepeaterTraceRoute,
  resolveMeshcoreTraceOutPathSeed,
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

  it('requires full hash-size dest prefix for 0-hop under 2-byte mode', () => {
    expect(meshcoreIsUsableTraceStoredPath(new Uint8Array([0xab]), 0, pubKey, 2)).toBe(false);
    expect(meshcoreIsUsableTraceStoredPath(new Uint8Array([0xab, 0xcd]), 0, pubKey, 2)).toBe(true);
  });

  it('allows full pubkey only for 0-hop (direct-retry send path)', () => {
    expect(meshcoreIsUsableTraceStoredPath(new Uint8Array(pubKey), 0, pubKey)).toBe(true);
    expect(meshcoreIsUsableTraceStoredPath(new Uint8Array(pubKey), 1, pubKey)).toBe(false);
  });

  it('rejects 32-byte paths for multi-hop even when bytes differ from pubkey', () => {
    const oddPath = Uint8Array.from({ length: 32 }, (_, i) => i);
    expect(meshcoreIsUsableTraceStoredPath(oddPath, 1, pubKey)).toBe(false);
  });

  it('rejects a stored route too short for the hop count (1-byte: hops + 1; wider: hops * size)', () => {
    // 1-byte hashes: a stored route is its relays plus one trailing byte.
    expect(meshcoreIsUsableTraceStoredPath(new Uint8Array([0x11]), 1, pubKey)).toBe(false);
    expect(meshcoreIsUsableTraceStoredPath(new Uint8Array([0x11, 0x22]), 1, pubKey)).toBe(true);
    expect(meshcoreIsUsableTraceStoredPath(new Uint8Array([0x11, 0x22]), 2, pubKey)).toBe(false);
    expect(meshcoreIsUsableTraceStoredPath(new Uint8Array([0x11, 0x22, 0x33]), 3, pubKey)).toBe(
      false,
    );
    expect(
      meshcoreIsUsableTraceStoredPath(new Uint8Array([0x11, 0x22, 0x33, 0x44]), 3, pubKey),
    ).toBe(true);
    // 2-byte hashes: a stored route is exactly its relay hashes.
    expect(meshcoreIsUsableTraceStoredPath(new Uint8Array([0x11, 0x12]), 1, pubKey, 2)).toBe(true);
    expect(meshcoreIsUsableTraceStoredPath(new Uint8Array([0x11]), 1, pubKey, 2)).toBe(false);
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
    expect(plan.pathTooShort).toBe(false);
    expect(plan.hashSizeBytes).toBe(1);
    expect(plan.outPathSeed).toEqual(new Uint8Array([0xab]));
  });

  it('0-hop: companion pathHashMode 2-byte used when radioContactPathLen is null', () => {
    const plan = planMeshcoreRepeaterTraceRoute({
      storedPath: undefined,
      hopsAway: 0,
      pubKey,
      radioContactPathLen: null,
      companionPathHashMode: 1,
    });
    expect(plan.hashSizeBytes).toBe(2);
    expect(plan.outPathSeed).toEqual(pubKey.subarray(0, 2));
  });

  it('0-hop: widens a stale 1-byte seed to 2 bytes under 2-byte path hashes', () => {
    const plan = planMeshcoreRepeaterTraceRoute({
      storedPath: new Uint8Array([0xab]),
      hopsAway: 0,
      pubKey,
      radioContactPathLen: null,
      companionPathHashMode: 1,
    });
    expect(plan.pathTooShort).toBe(true);
    expect(plan.storedPath).toBeUndefined();
    expect(plan.outPathSeed).toEqual(pubKey.subarray(0, 2));
  });

  it('0-hop: companion pathHashMode 3-byte seeds a 3-byte dest prefix', () => {
    const plan = planMeshcoreRepeaterTraceRoute({
      storedPath: undefined,
      hopsAway: 0,
      pubKey,
      radioContactPathLen: null,
      companionPathHashMode: 2,
    });
    expect(plan.hashSizeBytes).toBe(3);
    expect(plan.outPathSeed).toEqual(pubKey.subarray(0, 3));
  });

  it('0-hop: packed contact outPathLen wins over companion pathHashMode', () => {
    const plan = planMeshcoreRepeaterTraceRoute({
      storedPath: undefined,
      hopsAway: 0,
      pubKey,
      radioContactPathLen: 64,
      companionPathHashMode: 0,
    });
    expect(plan.outPathSeed).toEqual(pubKey.subarray(0, 2));
  });

  it('packed outPathLen with hopCount>=1 is radio multi-hop', () => {
    // 0x41 = hopCount 1, 2-byte hashes
    const plan = planMeshcoreRepeaterTraceRoute({
      storedPath: undefined,
      hopsAway: 0,
      pubKey,
      radioContactPathLen: 0x41,
    });
    expect(plan.radioSaysMultiHop).toBe(true);
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

  it('1-hop: 2-byte path hashes accept a 2-byte relay intermediate without priming', () => {
    const relayPath = new Uint8Array([0x11, 0x22]);
    const plan = planMeshcoreRepeaterTraceRoute({
      storedPath: relayPath,
      hopsAway: 1,
      pubKey,
      radioContactPathLen: null,
      companionPathHashMode: 1,
    });
    expect(plan.hashSizeBytes).toBe(2);
    expect(plan.pathTooShort).toBe(false);
    expect(plan.needsRoutePrime).toBe(false);
    expect(plan.storedPath).toEqual(relayPath);
  });

  it('1-hop: prefers path history when map holds invalid full pubkey and radio confirms route', () => {
    const historyPath = new Uint8Array([0xaa, 0xbb]);
    const plan = planMeshcoreRepeaterTraceRoute({
      storedPath: new Uint8Array(pubKey),
      hopsAway: 1,
      pubKey,
      radioContactPathLen: 1,
      pathFromHistory: historyPath,
    });
    expect(plan.storedPath).toEqual(historyPath);
    expect(plan.needsRoutePrime).toBe(false);
    expect(plan.outPathSeed).toEqual(historyPath);
  });

  it('1-hop: uses path history when a 3-byte route length arrives as a negative int8', () => {
    const historyPath = new Uint8Array([0x57, 0xa1, 0x11]);
    const plan = planMeshcoreRepeaterTraceRoute({
      storedPath: new Uint8Array(pubKey),
      hopsAway: 1,
      pubKey,
      // 0x81 (one hop of 3-byte hashes) as meshcore.js reads it.
      radioContactPathLen: 0x81 - 256,
      pathFromHistory: historyPath,
    });
    expect(plan.hashSizeBytes).toBe(3);
    expect(plan.storedPath).toEqual(historyPath);
    expect(plan.pathTooShort).toBe(false);
    expect(plan.needsRoutePrime).toBe(false);
  });

  it('1-hop: ignores path history when radio reports no outbound path', () => {
    const historyPath = new Uint8Array([0xaa, 0xbb]);
    const plan = planMeshcoreRepeaterTraceRoute({
      storedPath: undefined,
      hopsAway: 1,
      pubKey,
      radioContactPathLen: -1,
      pathFromHistory: historyPath,
    });
    expect(plan.storedPath).toBeUndefined();
    expect(plan.needsRoutePrime).toBe(true);
  });
});

describe('meshcoreTraceDirectRetryEligible', () => {
  it('allows direct retry for 0-hop short hash prefixes (1–3 bytes), not full pubkey', () => {
    expect(meshcoreTraceDirectRetryEligible(0, 1)).toBe(true);
    expect(meshcoreTraceDirectRetryEligible(0, 2)).toBe(true);
    expect(meshcoreTraceDirectRetryEligible(0, 3)).toBe(true);
    expect(meshcoreTraceDirectRetryEligible(0, 32)).toBe(false);
    expect(meshcoreTraceDirectRetryEligible(1, 1)).toBe(false);
  });
});

describe('meshcoreTraceCancelledForCliPreempt', () => {
  it('detects 0-hop CLI preempt cancel reasons', () => {
    expect(meshcoreTraceCancelledForCliPreempt(new Error(MESHCORE_CLI_PREEMPT_TRACE_REASON))).toBe(
      true,
    );
    expect(meshcoreTraceCancelledForCliPreempt(new Error('timeout'))).toBe(false);
    expect(meshcoreTraceCancelledForCliPreempt('0-hop CLI preempted stuck ping')).toBe(true);
  });
});

describe('meshcoreRadioContactPathLenSaysMultiHop', () => {
  it('treats plain last-byte-index 0 as direct and 1+ as multi-hop', () => {
    expect(meshcoreRadioContactPathLenSaysMultiHop(0)).toBe(false);
    expect(meshcoreRadioContactPathLenSaysMultiHop(1)).toBe(true);
    expect(meshcoreRadioContactPathLenSaysMultiHop(61)).toBe(true);
  });

  it('unpacks packed path_length bytes (64 = 0 hops / 2-byte hashes)', () => {
    expect(meshcoreRadioContactPathLenSaysMultiHop(64)).toBe(false);
    expect(meshcoreRadioContactPathLenSaysMultiHop(0x41)).toBe(true);
  });
});

describe('meshcoreShouldAbortMultiHopPingNoRoute', () => {
  it('aborts when radio confirms multi-hop but path bytes are missing', () => {
    expect(meshcoreShouldAbortMultiHopPingNoRoute(true, 1, true, true)).toBe(true);
  });

  it('aborts for UI 1-hop without path when radio does not confirm multi-hop', () => {
    expect(meshcoreShouldAbortMultiHopPingNoRoute(true, 1, true, false)).toBe(true);
  });

  it('aborts for 2+ UI hops without path', () => {
    expect(meshcoreShouldAbortMultiHopPingNoRoute(true, 2, true, false)).toBe(true);
  });

  it('does not abort when a resolved path exists despite pathTooShort plan', () => {
    expect(meshcoreShouldAbortMultiHopPingNoRoute(true, 2, true, true, true)).toBe(false);
  });
});

describe('meshcoreSynthesizeOneHopTracePath', () => {
  it('builds outbound [relayPrefix] from a direct repeater', () => {
    const relay = new Uint8Array(32);
    relay[0] = 0x06;
    const dest = new Uint8Array(32);
    dest[0] = 0x3d;
    expect(meshcoreSynthesizeOneHopTracePath(dest, [relay])).toEqual(new Uint8Array([0x06]));
  });

  it('uses 2-byte relay prefixes when path hash mode is 2-byte', () => {
    const relay = new Uint8Array(32);
    relay[0] = 0x57;
    relay[1] = 0xaa;
    const dest = new Uint8Array(32);
    dest[0] = 0x07;
    dest[1] = 0xbb;
    expect(meshcoreSynthesizeOneHopTracePath(dest, [relay], 2)).toEqual(
      new Uint8Array([0x57, 0xaa]),
    );
  });

  it('uses 3-byte relay prefixes when path hash mode is 3-byte', () => {
    const relay = new Uint8Array(32);
    relay[0] = 0x57;
    relay[1] = 0xaa;
    relay[2] = 0x11;
    const dest = new Uint8Array(32);
    dest[0] = 0x07;
    dest[1] = 0xbb;
    dest[2] = 0x22;
    expect(meshcoreSynthesizeOneHopTracePath(dest, [relay], 3)).toEqual(
      new Uint8Array([0x57, 0xaa, 0x11]),
    );
  });
});

describe('stored route shape', () => {
  const dest = makePubKey(0x07);

  it('drops the trailing byte of a 1-byte stored route and keeps wider routes whole', () => {
    expect(meshcoreTraceOutboundFromStoredPath(new Uint8Array([0x57, 0xee]), 1)).toEqual(
      new Uint8Array([0x57]),
    );
    expect(meshcoreTraceOutboundFromStoredPath(new Uint8Array([0x57, 0x21, 0xee]), 1)).toEqual(
      new Uint8Array([0x57, 0x21]),
    );
    expect(meshcoreTraceOutboundFromStoredPath(new Uint8Array([0x57, 0xa1]), 2)).toEqual(
      new Uint8Array([0x57, 0xa1]),
    );
    expect(meshcoreTraceOutboundFromStoredPath(new Uint8Array([0x57, 0xa1, 0x11]), 3)).toEqual(
      new Uint8Array([0x57, 0xa1, 0x11]),
    );
  });

  it('stores 1-byte relays with a trailing byte so hop readers count length - 1', () => {
    const stored = meshcoreTraceStoredPathFromOutbound(new Uint8Array([0x57]), dest, 1);
    expect(stored).toEqual(new Uint8Array([0x57, 0x07]));
    expect(meshcoreTraceOutboundFromStoredPath(stored, 1)).toEqual(new Uint8Array([0x57]));
    expect(meshcoreTraceStoredPathFromOutbound(new Uint8Array([0x57, 0xa1]), dest, 2)).toEqual(
      new Uint8Array([0x57, 0xa1]),
    );
  });
});

describe('meshcoreTraceOutboundLegOfRoundTrip', () => {
  it('keeps the relays and the destination with the SNRs heard on the way out', () => {
    // Two relays at 2-byte entries: r1, r2, dest, r2, r1. SNRs: r1, r2, dest, r2, r1 heard it.
    expect(
      meshcoreTraceOutboundLegOfRoundTrip({
        pathHashes: [0x57, 0xa1, 0x21, 0xb2, 0x07, 0xc3, 0x21, 0xb2, 0x57, 0xa1],
        pathSnrsDb: [9, 8, 7, 6, 5],
        entryBytes: 2,
      }),
    ).toEqual({
      pathHashes: [0x57, 0xa1, 0x21, 0xb2, 0x07, 0xc3],
      pathSnrsDb: [9, 8],
      destSnrDb: 7,
    });
  });

  it('returns null when the reply is not a whole round trip', () => {
    expect(
      meshcoreTraceOutboundLegOfRoundTrip({
        pathHashes: [0x57, 0x07],
        pathSnrsDb: [9, 8],
        entryBytes: 1,
      }),
    ).toBeNull();
    expect(
      meshcoreTraceOutboundLegOfRoundTrip({
        pathHashes: [0x57, 0x07, 0x57],
        pathSnrsDb: [9],
        entryBytes: 1,
      }),
    ).toBeNull();
  });
});

describe('meshcoreHashSizeForTraceSeed', () => {
  it('reads a routed contact at the size its own length byte packs', () => {
    // Plain 1: one hop of 1-byte hashes, even on a companion set to 2-byte hashes.
    expect(meshcoreHashSizeForTraceSeed(1, 1)).toBe(1);
    expect(meshcoreHashSizeForTraceSeed(0x41, 0)).toBe(2);
    // 0x81 read by meshcore.js as int8.
    expect(meshcoreHashSizeForTraceSeed(0x81 - 256, 0)).toBe(3);
  });

  it('uses the companion mode when the contact has no route or a plain zero-hop one', () => {
    expect(meshcoreHashSizeForTraceSeed(0, 1)).toBe(2);
    expect(meshcoreHashSizeForTraceSeed(-1, 2)).toBe(3);
    expect(meshcoreHashSizeForTraceSeed(null, null)).toBe(1);
    // A packed zero-hop length still carries its size.
    expect(meshcoreHashSizeForTraceSeed(0x40, 0)).toBe(2);
  });
});

describe('meshcoreExpandTracePathWithAutoReturn', () => {
  it('adds the destination even when the last relay hash equals the destination prefix', () => {
    const dest = makePubKey(0x07);
    expect(meshcoreExpandTracePathWithAutoReturn(new Uint8Array([0x57, 0x07]), dest, 1)).toEqual(
      new Uint8Array([0x57, 0x07, 0x07, 0x07, 0x57]),
    );
  });

  it('expands 1-hop outbound into relay→dest→relay so TraceData returns', () => {
    const dest = makePubKey(0x07);
    dest[1] = 0x00;
    expect(meshcoreExpandTracePathWithAutoReturn(new Uint8Array([0x57, 0x31]), dest, 2)).toEqual(
      new Uint8Array([0x57, 0x31, 0x07, 0x00, 0x57, 0x31]),
    );
  });

  it('keeps zero-hop as a single dest prefix', () => {
    const dest = makePubKey(0x06);
    expect(meshcoreExpandTracePathWithAutoReturn(new Uint8Array(0), dest, 2)).toEqual(
      dest.subarray(0, 2),
    );
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

describe('computeMeshcoreTracePrimeStrategy', () => {
  it('returns passive for multi-hop missing path', () => {
    expect(
      computeMeshcoreTracePrimeStrategy({
        needsRoutePrime: true,
        pathTooShort: true,
        hopsAway: 2,
        hasUsableStoredPath: false,
        canSynthesizePath: false,
      }),
    ).toBe('passive');
  });

  it('returns passive for unknown hopsAway when path is missing', () => {
    expect(
      computeMeshcoreTracePrimeStrategy({
        needsRoutePrime: true,
        pathTooShort: true,
        hopsAway: null,
        hasUsableStoredPath: false,
        canSynthesizePath: false,
      }),
    ).toBe('passive');
  });

  it('still passive when synthesis is available but radio path is missing', () => {
    expect(
      computeMeshcoreTracePrimeStrategy({
        needsRoutePrime: true,
        pathTooShort: true,
        hopsAway: 1,
        hasUsableStoredPath: false,
        canSynthesizePath: true,
      }),
    ).toBe('passive');
  });
});

describe('meshcoreSynthesizeMultiHopTracePath', () => {
  it('composes two relays for 2-hop from a direct relay and a 1-hop stored route', () => {
    const relayKey = new Uint8Array(32);
    relayKey[0] = 0x06;
    const dest = makePubKey(0x3d);
    const destId = 99;
    const nodes = new Map([[1, { hops_away: 0, hw_model: 'Repeater' }]]);
    const pubKeys = new Map([
      [1, relayKey],
      [destId, dest],
    ]);
    // Stored 1-byte route: the relay 0x11 plus one trailing byte that is not a hop.
    const pathByNode = new Map([[destId, new Uint8Array([0x11, 0xee])]]);
    expect(
      meshcoreSynthesizeMultiHopTracePath({
        destPubKey: dest,
        hopsAway: 2,
        nodes,
        pubKeyByNodeId: pubKeys,
        excludeNodeId: destId,
        pathByNodeId: pathByNode,
      }),
    ).toEqual(new Uint8Array([0x06, 0x11]));
  });

  it('composes 4-byte intermediate path for 2-hop under 2-byte path hashes', () => {
    const relayKey = new Uint8Array(32);
    relayKey[0] = 0x06;
    relayKey[1] = 0xaa;
    const dest = makePubKey(0x3d);
    dest[1] = 0xbb;
    const destId = 99;
    const nodes = new Map([[1, { hops_away: 0, hw_model: 'Repeater' }]]);
    const pubKeys = new Map([
      [1, relayKey],
      [destId, dest],
    ]);
    const pathByNode = new Map([[destId, new Uint8Array([0x11, 0x12])]]);
    expect(
      meshcoreSynthesizeMultiHopTracePath({
        destPubKey: dest,
        hopsAway: 2,
        nodes,
        pubKeyByNodeId: pubKeys,
        excludeNodeId: destId,
        pathByNodeId: pathByNode,
        hashSizeBytes: 2,
      }),
    ).toEqual(new Uint8Array([0x06, 0xaa, 0x11, 0x12]));
  });
});

describe('resolveMeshcoreTraceOutPathSeed', () => {
  it('returns synthesized path when plan is too short', () => {
    const relayKey = new Uint8Array(32);
    relayKey[0] = 0x06;
    const dest = makePubKey(0x3d);
    const destId = 42;
    const plan = planMeshcoreRepeaterTraceRoute({
      storedPath: undefined,
      hopsAway: 1,
      pubKey: dest,
      radioContactPathLen: null,
    });
    const nodes = new Map([[1, { hops_away: 0, hw_model: 'Repeater' }]]);
    const pubKeys = new Map([
      [1, relayKey],
      [destId, dest],
    ]);
    const resolved = resolveMeshcoreTraceOutPathSeed({
      tracePlan: plan,
      pubKey: dest,
      hopsAway: 1,
      nodeId: destId,
      nodes,
      pubKeyByNodeId: pubKeys,
      pathByNodeId: new Map(),
    });
    expect(resolved.composed).toBe(true);
    expect(resolved.autoReturn).toBe(true);
    expect(resolved.outboundPath).toEqual(new Uint8Array([0x06]));
    expect(resolved.outPath).toEqual(new Uint8Array([0x06, 0x3d, 0x06]));
  });

  it('synthesizes auto-return 2-byte-hash one-hop path when hashSizeBytes is 2', () => {
    const relayKey = new Uint8Array(32);
    relayKey[0] = 0x57;
    relayKey[1] = 0xaa;
    const dest = makePubKey(0x07);
    dest[1] = 0xbb;
    const destId = 42;
    const plan = planMeshcoreRepeaterTraceRoute({
      storedPath: undefined,
      hopsAway: 1,
      pubKey: dest,
      radioContactPathLen: null,
      companionPathHashMode: 1,
    });
    const nodes = new Map([[1, { hops_away: 0, hw_model: 'Repeater' }]]);
    const pubKeys = new Map([
      [1, relayKey],
      [destId, dest],
    ]);
    const resolved = resolveMeshcoreTraceOutPathSeed({
      tracePlan: plan,
      pubKey: dest,
      hopsAway: 1,
      nodeId: destId,
      nodes,
      pubKeyByNodeId: pubKeys,
      pathByNodeId: new Map(),
      hashSizeBytes: 2,
    });
    expect(resolved.composed).toBe(true);
    expect(resolved.autoReturn).toBe(true);
    expect(resolved.outboundPath).toEqual(new Uint8Array([0x57, 0xaa]));
    expect(resolved.outPath).toEqual(new Uint8Array([0x57, 0xaa, 0x07, 0xbb, 0x57, 0xaa]));
  });
});

describe('evaluateMeshcorePingRouteAbort', () => {
  it('aborts when flood priming is exhausted without composed path', () => {
    expect(
      evaluateMeshcorePingRouteAbort({
        floodPrimeExhausted: true,
        pathResolvedComposed: false,
        pathTooShort: false,
        hopsAway: 2,
        uiSaysMultiHop: false,
        radioSaysMultiHop: false,
        hasResolvedPath: false,
      }),
    ).toBe(true);
  });

  it('delegates to meshcoreShouldAbortMultiHopPingNoRoute when flood not exhausted', () => {
    expect(
      evaluateMeshcorePingRouteAbort({
        floodPrimeExhausted: false,
        pathResolvedComposed: false,
        pathTooShort: true,
        hopsAway: 2,
        uiSaysMultiHop: true,
        radioSaysMultiHop: false,
        hasResolvedPath: false,
      }),
    ).toBe(true);
  });
});
