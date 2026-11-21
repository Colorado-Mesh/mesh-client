import { describe, expect, it } from 'vitest';

import {
  buildAx25UiFrame,
  decodeAx25Callsign,
  encodeAx25Callsign,
  formatAprsAddressee,
  parseAx25UiFrame,
} from './meshcomAx25';

describe('meshcomAx25', () => {
  it('encodes and decodes callsign with SSID', () => {
    const field = encodeAx25Callsign('DH1FR-7', { last: true });
    expect(field).toHaveLength(7);
    const decoded = decodeAx25Callsign(field);
    expect(decoded).toMatchObject({ callsign: 'DH1FR-7', ssid: 7, last: true });
  });

  it('clamps SSID to 0–15 on the wire', () => {
    const field = encodeAx25Callsign('OE1XYZ-99', { last: true });
    const decoded = decodeAx25Callsign(field);
    expect(decoded?.ssid).toBe(15);
    expect(decoded?.callsign).toBe('OE1XYZ-15');
  });

  it('builds and parses a UI frame', () => {
    const frame = buildAx25UiFrame({
      dest: 'APRS',
      src: 'DH1FR-7',
      info: ':DH1FR-1  :hello',
    });
    const parsed = parseAx25UiFrame(frame);
    expect(parsed).not.toBeNull();
    expect(parsed!.dest.callsign).toBe('APRS');
    expect(parsed!.src.callsign).toBe('DH1FR-7');
    expect(new TextDecoder().decode(parsed!.info)).toBe(':DH1FR-1  :hello');
  });

  it('pads APRS addressee to 9 characters', () => {
    expect(formatAprsAddressee('DH1FR-1')).toBe('DH1FR-1  ');
    expect(formatAprsAddressee('*')).toBe('*        ');
    expect(formatAprsAddressee('OE1XYZ-99')).toBe('OE1XYZ-99');
  });
});
