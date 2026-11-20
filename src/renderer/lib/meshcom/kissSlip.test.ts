import { describe, expect, it } from 'vitest';

import { KISS_FEND, KISS_FESC, kissSlipDecode, KissSlipDeframer, kissSlipEncode } from './kissSlip';

describe('kissSlip', () => {
  it('round-trips payload including FEND/FESC bytes', () => {
    const payload = new Uint8Array([0x00, KISS_FEND, 0x51, KISS_FESC, 0x02]);
    const framed = kissSlipEncode(payload);
    expect(framed[0]).toBe(KISS_FEND);
    expect(framed[framed.length - 1]).toBe(KISS_FEND);
    // Strip outer FENDs for decode (body only).
    const body = framed.subarray(1, framed.length - 1);
    expect(kissSlipDecode(body)).toEqual(payload);
  });

  it('rejects truncated escape sequences', () => {
    expect(kissSlipDecode([KISS_FESC])).toBeNull();
    expect(kissSlipDecode([KISS_FESC, 0x00])).toBeNull();
  });

  it('deframes across TCP chunks and ignores empty FENDs', () => {
    const payload = new Uint8Array([0x00, 0x01, 0x02]);
    const framed = kissSlipEncode(payload);
    const deframer = new KissSlipDeframer();
    expect(deframer.push(framed.subarray(0, 3))).toEqual([]);
    const rest = deframer.push(framed.subarray(3));
    expect(rest).toHaveLength(1);
    expect(rest[0]).toEqual(payload);
    expect(deframer.push([KISS_FEND, KISS_FEND])).toEqual([]);
  });
});
