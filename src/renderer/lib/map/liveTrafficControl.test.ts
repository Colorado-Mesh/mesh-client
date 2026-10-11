import { describe, expect, it } from 'vitest';

import { liveTrafficControlSubtype } from './liveTrafficControl';

describe('liveTrafficControlSubtype', () => {
  it.each([
    ['80', 'DISCOVER_REQ'],
    ['8f0102030405', 'DISCOVER_REQ'],
    ['90', 'DISCOVER_RESP'],
    ['921b01020304' + 'ab'.repeat(8), 'DISCOVER_RESP'],
  ])(
    'recognizes the control discriminator in %s without claiming a complete body',
    (raw, subtype) => {
      expect(liveTrafficControlSubtype('CONTROL', undefined, raw)).toBe(subtype);
      expect(
        liveTrafficControlSubtype(
          'CONTROL',
          undefined,
          Uint8Array.from(raw.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16)),
        ),
      ).toBe(subtype);
    },
  );

  it.each(['', '8', '80x0', '80\n', '70', 'a0', '00', '80'.repeat(32_769)])(
    'leaves empty, malformed, or unknown raw controls generic',
    (raw) => {
      expect(liveTrafficControlSubtype('CONTROL', 'DISCOVER_REQ', raw)).toBeUndefined();
    },
  );

  it('accepts decoded discovery names when raw bytes are absent and gives bytes precedence', () => {
    expect(liveTrafficControlSubtype('CONTROL', 'discover_req')).toBe('DISCOVER_REQ');
    expect(liveTrafficControlSubtype('CONTROL', 'Discover_Resp')).toBe('DISCOVER_RESP');
    expect(liveTrafficControlSubtype('CONTROL', 'DISCOVER_REQ', new Uint8Array([0x92]))).toBe(
      'DISCOVER_RESP',
    );
    expect(liveTrafficControlSubtype('CONTROL', 'DISCOVER_REQ', new Uint8Array())).toBeUndefined();
    expect(liveTrafficControlSubtype('CONTROL', 'OTHER')).toBeUndefined();
  });

  it('never interprets another packet category as a control', () => {
    expect(liveTrafficControlSubtype('ADVERT', 'DISCOVER_REQ', '80')).toBeUndefined();
    expect(liveTrafficControlSubtype('UNKNOWN', 'DISCOVER_RESP')).toBeUndefined();
  });
});
