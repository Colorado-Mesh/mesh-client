import { describe, expect, it } from 'vitest';

import {
  findDuplicateVirtualizerKeys,
  MAX_RAW_PACKET_LOG_ENTRIES,
  rawPacketContentKey,
  rawPacketVirtualizerKey,
} from './rawPacketLogConstants';

describe('rawPacketLogConstants', () => {
  it('uses 2500 entry cap aligned with MeshCore and Meshtastic raw logs', () => {
    expect(MAX_RAW_PACKET_LOG_ENTRIES).toBe(2500);
  });
});

describe('rawPacket virtualizer keys', () => {
  const ts = 1_782_858_453_020;
  const raw = new Uint8Array([0x51, 0x02, 0x2e, 0x6c, ...Array(343).fill(0)]);

  it('content key collides for identical duplicate captures', () => {
    expect(rawPacketContentKey(ts, raw)).toBe('1782858453020-347-51022e6c');
    expect(rawPacketContentKey(ts, raw)).toBe(rawPacketContentKey(ts, new Uint8Array(raw)));
  });

  it('virtualizer keys stay unique when content is identical', () => {
    const entries = [
      { ts, raw },
      { ts, raw },
    ];
    const keys = entries.map((e, i) => rawPacketVirtualizerKey(e.ts, e.raw, i));
    expect(keys[0]).not.toBe(keys[1]);
    expect(
      findDuplicateVirtualizerKeys(entries, (e, i) => rawPacketVirtualizerKey(e.ts, e.raw, i)),
    ).toEqual([]);
  });

  it('empty raw payload still yields unique virtualizer keys per index', () => {
    const empty = new Uint8Array(0);
    expect(rawPacketContentKey(ts, empty)).toBe(`${ts}-0-empty`);
    expect(
      findDuplicateVirtualizerKeys(
        [
          { ts, raw: empty },
          { ts, raw: empty },
        ],
        (e, i) => rawPacketVirtualizerKey(e.ts, e.raw, i),
      ),
    ).toEqual([]);
  });
});
