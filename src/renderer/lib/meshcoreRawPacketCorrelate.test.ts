import { describe, expect, it } from 'vitest';

import {
  type ChatCorrelateRxLike,
  MESHCORE_CHAT_CORRELATE_WINDOW_MS,
  meshcoreCorrelateOrSynthesizeChatEntry,
  meshcoreFindRecentGrpTxtRawPacket,
  meshcoreFindRecentTxtMsgRawPacket,
  resolveMeshcoreIngestRxHops,
} from './meshcoreRawPacketCorrelate';
import { MAX_RAW_PACKET_LOG_ENTRIES } from './rawPacketLogConstants';

function entry(
  partial: Partial<ChatCorrelateRxLike> & Pick<ChatCorrelateRxLike, 'ts'>,
): ChatCorrelateRxLike {
  return {
    payloadTypeString: 'TXT_MSG',
    fromNodeId: null,
    ...partial,
  };
}

function synth(ts: number): ChatCorrelateRxLike {
  return { ts, payloadTypeString: 'TXT_MSG', fromNodeId: 0xabc };
}

const WINDOW = MESHCORE_CHAT_CORRELATE_WINDOW_MS;

describe('meshcoreCorrelateOrSynthesizeChatEntry', () => {
  it('backfills fromNodeId on the most recent unattributed TXT_MSG within window', () => {
    const base: ChatCorrelateRxLike[] = [entry({ ts: 1000 }), entry({ ts: 2000 })];
    const result = meshcoreCorrelateOrSynthesizeChatEntry(
      base,
      'TXT_MSG',
      0xdeadbeef,
      synth(2100),
      WINDOW,
    );
    expect(result).toHaveLength(2);
    expect(result[1].fromNodeId).toBe(0xdeadbeef);
    expect(result[0].fromNodeId).toBeNull();
  });

  it('backfills the last unattributed entry, not earlier ones', () => {
    const base: ChatCorrelateRxLike[] = [
      entry({ ts: 1000 }),
      entry({ ts: 1500 }),
      entry({ ts: 2000 }),
    ];
    const result = meshcoreCorrelateOrSynthesizeChatEntry(
      base,
      'TXT_MSG',
      0x1111,
      synth(2050),
      WINDOW,
    );
    expect(result[2].fromNodeId).toBe(0x1111);
    expect(result[1].fromNodeId).toBeNull();
    expect(result[0].fromNodeId).toBeNull();
  });

  it('does not touch entries outside the window', () => {
    const old = entry({ ts: 0 });
    const base: ChatCorrelateRxLike[] = [old];
    const result = meshcoreCorrelateOrSynthesizeChatEntry(
      base,
      'TXT_MSG',
      0x1234,
      synth(WINDOW + 1),
      WINDOW,
    );
    // Out of window -> appends synthetic
    expect(result).toHaveLength(2);
    expect(result[0].fromNodeId).toBeNull();
    expect(result[1].fromNodeId).toBe(0xabc);
  });

  it('does not overwrite an entry that already has fromNodeId', () => {
    const base: ChatCorrelateRxLike[] = [entry({ ts: 1000, fromNodeId: 0x9999 })];
    const result = meshcoreCorrelateOrSynthesizeChatEntry(
      base,
      'TXT_MSG',
      0x1111,
      synth(1100),
      WINDOW,
    );
    // Already attributed -> appends synthetic
    expect(result).toHaveLength(2);
    expect(result[0].fromNodeId).toBe(0x9999);
  });

  it('appends synthetic when no matching entry exists', () => {
    const result = meshcoreCorrelateOrSynthesizeChatEntry(
      [],
      'TXT_MSG',
      0xabc,
      synth(5000),
      WINDOW,
    );
    expect(result).toHaveLength(1);
    expect(result[0].fromNodeId).toBe(0xabc);
    expect(result[0].payloadTypeString).toBe('TXT_MSG');
  });

  it('appends synthetic when only entry has wrong payload type', () => {
    const base: ChatCorrelateRxLike[] = [entry({ ts: 1000, payloadTypeString: 'ADVERT' })];
    const grpSynth: ChatCorrelateRxLike = { ts: 1200, payloadTypeString: 'GRP_TXT', fromNodeId: 7 };
    const result = meshcoreCorrelateOrSynthesizeChatEntry(base, 'GRP_TXT', 7, grpSynth, WINDOW);
    expect(result).toHaveLength(2);
    expect(result[1].payloadTypeString).toBe('GRP_TXT');
  });

  it('works for GRP_TXT payload type', () => {
    const base: ChatCorrelateRxLike[] = [entry({ ts: 1000, payloadTypeString: 'GRP_TXT' })];
    const grpSynth: ChatCorrelateRxLike = {
      ts: 1100,
      payloadTypeString: 'GRP_TXT',
      fromNodeId: 55,
    };
    const result = meshcoreCorrelateOrSynthesizeChatEntry(base, 'GRP_TXT', 55, grpSynth, WINDOW);
    expect(result).toHaveLength(1);
    expect(result[0].fromNodeId).toBe(55);
  });

  it('caps array at MAX_RAW_PACKET_LOG_ENTRIES when synthetic is appended', () => {
    const base: ChatCorrelateRxLike[] = Array.from({ length: MAX_RAW_PACKET_LOG_ENTRIES }, (_, i) =>
      entry({ ts: i, payloadTypeString: 'ADVERT' }),
    );
    const result = meshcoreCorrelateOrSynthesizeChatEntry(
      base,
      'TXT_MSG',
      1,
      synth(MAX_RAW_PACKET_LOG_ENTRIES + 1),
      WINDOW,
    );
    expect(result).toHaveLength(MAX_RAW_PACKET_LOG_ENTRIES);
    expect(result[result.length - 1].payloadTypeString).toBe('TXT_MSG');
  });

  it('passes null fromNodeId through to synthetic when sender is unknown', () => {
    const result = meshcoreCorrelateOrSynthesizeChatEntry(
      [],
      'TXT_MSG',
      null,
      { ts: 1000, payloadTypeString: 'TXT_MSG', fromNodeId: null },
      WINDOW,
    );
    expect(result).toHaveLength(1);
    expect(result[0].fromNodeId).toBeNull();
  });
});

describe('meshcoreFindRecentGrpTxtRawPacket', () => {
  const now = 10_000;

  it('returns the most recent GRP_TXT within the correlation window', () => {
    const packets: ChatCorrelateRxLike[] = [
      { ts: now - 500, payloadTypeString: 'GRP_TXT', fromNodeId: 1, hopCount: 1 },
      { ts: now - 200, payloadTypeString: 'GRP_TXT', fromNodeId: 2, hopCount: 3 },
    ];
    expect(meshcoreFindRecentGrpTxtRawPacket(packets, now)?.hopCount).toBe(3);
  });

  it('returns undefined when log is empty or entries are stale', () => {
    const emptyPackets: ChatCorrelateRxLike[] = [];
    expect(meshcoreFindRecentGrpTxtRawPacket(emptyPackets, now)).toBeUndefined();
    const stale: ChatCorrelateRxLike[] = [
      {
        ts: now - MESHCORE_CHAT_CORRELATE_WINDOW_MS - 1,
        payloadTypeString: 'GRP_TXT',
        fromNodeId: null,
      },
    ];
    expect(meshcoreFindRecentGrpTxtRawPacket(stale, now)).toBeUndefined();
  });

  it('matches GRP_TXT entries in the widened correlation window', () => {
    const packets: ChatCorrelateRxLike[] = [
      {
        ts: now - (MESHCORE_CHAT_CORRELATE_WINDOW_MS - 500),
        payloadTypeString: 'GRP_TXT',
        fromNodeId: null,
        hopCount: 4,
      },
    ];
    expect(meshcoreFindRecentGrpTxtRawPacket(packets, now)?.hopCount).toBe(4);
  });

  it('rejects GRP_TXT just outside the correlation window', () => {
    const packets: ChatCorrelateRxLike[] = [
      {
        ts: now - MESHCORE_CHAT_CORRELATE_WINDOW_MS - 1,
        payloadTypeString: 'GRP_TXT',
        fromNodeId: null,
        hopCount: 4,
      },
    ];
    expect(meshcoreFindRecentGrpTxtRawPacket(packets, now)).toBeUndefined();
  });
});

describe('meshcoreFindRecentTxtMsgRawPacket', () => {
  const now = 20_000;

  it('returns the most recent TXT_MSG within window (attributed or not)', () => {
    const packets: ChatCorrelateRxLike[] = [
      { ts: now - 400, payloadTypeString: 'TXT_MSG', fromNodeId: null, hopCount: 9 },
      { ts: now - 100, payloadTypeString: 'TXT_MSG', fromNodeId: 0xabc, hopCount: 2 },
    ];
    expect(meshcoreFindRecentTxtMsgRawPacket(packets, now)?.hopCount).toBe(2);
  });

  it('matches attributed TXT_MSG in the correlation window', () => {
    const packets: ChatCorrelateRxLike[] = [
      {
        ts: now - (MESHCORE_CHAT_CORRELATE_WINDOW_MS - 500),
        payloadTypeString: 'TXT_MSG',
        fromNodeId: 0x111,
        hopCount: 6,
      },
    ];
    expect(meshcoreFindRecentTxtMsgRawPacket(packets, now)?.hopCount).toBe(6);
  });

  it('rejects TXT_MSG just outside the correlation window', () => {
    const packets: ChatCorrelateRxLike[] = [
      {
        ts: now - MESHCORE_CHAT_CORRELATE_WINDOW_MS - 1,
        payloadTypeString: 'TXT_MSG',
        fromNodeId: null,
        hopCount: 6,
      },
    ];
    expect(meshcoreFindRecentTxtMsgRawPacket(packets, now)).toBeUndefined();
  });

  it('ignores GRP_TXT rows when looking for TXT_MSG', () => {
    const packets: ChatCorrelateRxLike[] = [
      { ts: now - 100, payloadTypeString: 'GRP_TXT', fromNodeId: null, hopCount: 5 },
    ];
    expect(meshcoreFindRecentTxtMsgRawPacket(packets, now)).toBeUndefined();
  });

  it('scopes to the event sender when interleaved TXT_MSG rows share the window', () => {
    const packets: ChatCorrelateRxLike[] = [
      {
        ts: now - 300,
        payloadTypeString: 'TXT_MSG',
        fromNodeId: 0xaaa,
        hopCount: 1,
        parseOk: true,
      },
      {
        ts: now - 100,
        payloadTypeString: 'TXT_MSG',
        fromNodeId: 0xbbb,
        hopCount: 5,
        parseOk: true,
      },
    ];
    // Most recent overall is 0xbbb @ 5 hops — but ingesting 0xaaa must not adopt that.
    expect(
      meshcoreFindRecentTxtMsgRawPacket(packets, now, MESHCORE_CHAT_CORRELATE_WINDOW_MS, {
        fromNodeId: 0xaaa,
      })?.hopCount,
    ).toBe(1);
    expect(
      meshcoreFindRecentTxtMsgRawPacket(packets, now, MESHCORE_CHAT_CORRELATE_WINDOW_MS, {
        fromNodeId: 0xbbb,
      })?.hopCount,
    ).toBe(5);
  });

  it('matches TXT_MSG by fingerprint when fromNodeId differs or is null', () => {
    const packets: ChatCorrelateRxLike[] = [
      {
        ts: now - 200,
        payloadTypeString: 'TXT_MSG',
        fromNodeId: null,
        hopCount: 4,
        parseOk: true,
        messageFingerprintHex: 'deadbeef',
      },
      {
        ts: now - 50,
        payloadTypeString: 'TXT_MSG',
        fromNodeId: 0x999,
        hopCount: 9,
        parseOk: true,
        messageFingerprintHex: 'cafebabe',
      },
    ];
    expect(
      meshcoreFindRecentTxtMsgRawPacket(packets, now, MESHCORE_CHAT_CORRELATE_WINDOW_MS, {
        fromNodeId: 0x111,
        messageFingerprintHex: 'DEADBEEF',
      })?.hopCount,
    ).toBe(4);
  });
});

describe('resolveMeshcoreIngestRxHops', () => {
  const now = 30_000;

  it('resolves channel hops from GRP_TXT and DM hops from TXT_MSG', () => {
    const packets: ChatCorrelateRxLike[] = [
      { ts: now - 100, payloadTypeString: 'GRP_TXT', fromNodeId: null, hopCount: 2 },
      { ts: now - 100, payloadTypeString: 'TXT_MSG', fromNodeId: null, hopCount: 1 },
    ];
    expect(resolveMeshcoreIngestRxHops(packets, true, now)).toBe(2);
    expect(resolveMeshcoreIngestRxHops(packets, false, now)).toBe(1);
  });

  it('does not adopt another sender DM hops within the correlation window', () => {
    const packets: ChatCorrelateRxLike[] = [
      {
        ts: now - 400,
        payloadTypeString: 'TXT_MSG',
        fromNodeId: 0x111,
        hopCount: 2,
        parseOk: true,
      },
      { ts: now - 50, payloadTypeString: 'TXT_MSG', fromNodeId: 0x222, hopCount: 7, parseOk: true },
    ];
    expect(resolveMeshcoreIngestRxHops(packets, false, now, { fromNodeId: 0x111 })).toBe(2);
    expect(resolveMeshcoreIngestRxHops(packets, false, now, { fromNodeId: 0x333 })).toBeUndefined();
  });

  it('returns undefined when matched row has no hopCount', () => {
    const packets: ChatCorrelateRxLike[] = [
      { ts: now - 100, payloadTypeString: 'GRP_TXT', fromNodeId: null },
    ];
    expect(resolveMeshcoreIngestRxHops(packets, true, now)).toBeUndefined();
  });

  it('ignores hopCount from failed-parse or synthetic rows (parseOk false)', () => {
    const packets: ChatCorrelateRxLike[] = [
      {
        ts: now - 100,
        payloadTypeString: 'GRP_TXT',
        fromNodeId: null,
        hopCount: 0,
        parseOk: false,
      },
    ];
    expect(resolveMeshcoreIngestRxHops(packets, true, now)).toBeUndefined();
  });

  it('accepts hopCount when parseOk is true', () => {
    const packets: ChatCorrelateRxLike[] = [
      {
        ts: now - 100,
        payloadTypeString: 'TXT_MSG',
        fromNodeId: null,
        hopCount: 0,
        parseOk: true,
      },
    ];
    expect(resolveMeshcoreIngestRxHops(packets, false, now)).toBe(0);
  });
});
