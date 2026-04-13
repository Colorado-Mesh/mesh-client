import { describe, expect, it } from 'vitest';

import {
  type ChatCorrelateRxLike,
  MESHCORE_CHAT_CORRELATE_WINDOW_MS,
  meshcoreCorrelateOrSynthesizeChatEntry,
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
