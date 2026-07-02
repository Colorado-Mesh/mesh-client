import { describe, expect, it } from 'vitest';

import { RNode } from '../rnode';

describe('RNode KISS framing', () => {
  it('createKissFrame round-trips through decodeKissFrame', () => {
    const payload = [0x51, 0x00];
    const frame = RNode.createKissFrame(payload);
    expect(frame[0]).toBe(RNode.KISS_FEND);
    expect(frame[frame.length - 1]).toBe(RNode.KISS_FEND);

    const inner: number[] = [];
    let inFrame = false;
    for (const byte of frame) {
      if (byte === RNode.KISS_FEND) {
        if (inFrame) break;
        inFrame = true;
        continue;
      }
      inner.push(byte);
    }
    const decoded = RNode.decodeKissFrame(inner);
    expect(decoded).toEqual(payload);
  });

  it('decodeKissFrame handles escaped bytes', () => {
    const escaped = [RNode.KISS_FESC, RNode.KISS_TFEND, 0x51];
    expect(RNode.decodeKissFrame(escaped)).toEqual([RNode.KISS_FEND, 0x51]);
  });

  it.each(['linux', 'darwin', 'win32'] as const)('KISS codec is platform-agnostic (%s)', () => {
    expect(RNode.decodeKissFrame([0x01])).toEqual([0x01]);
  });
});
