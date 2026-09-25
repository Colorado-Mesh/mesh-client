import { describe, expect, it } from 'vitest';

import {
  encode,
  extractMecpCoords,
  getByteLength,
  incidentFingerprint,
  isMecpDrill,
  isMecpMessage,
  MAX_MESSAGE_BYTES,
  MECP_REGEX,
  tryParseMecp,
} from './mecpMessages';

describe('tryParseMecp / MECP_REGEX', () => {
  it('matches Meta.ai wire prefix', () => {
    expect(MECP_REGEX.test('MECP/0/M01')).toBe(true);
    expect(MECP_REGEX.test('MECP/3/L01')).toBe(true);
    expect(MECP_REGEX.test('MECP/4/M01')).toBe(false);
    expect(MECP_REGEX.test('hello')).toBe(false);
  });

  it('parses a full example', () => {
    const parsed = tryParseMecp('MECP/0/M01 M07 P05 2pax 48.65,20.13');
    expect(parsed).not.toBeNull();
    expect(parsed!.severity).toBe(0);
    expect(parsed!.codes).toEqual(['M01', 'M07', 'P05']);
    expect(parsed!.extracted.count).toBe(2);
    expect(parsed!.extracted.gps).toEqual({ lat: 48.65, lon: 20.13 });
    expect(parsed!.isDrill).toBe(false);
  });

  it('detects drill D01/D02 only', () => {
    const drill = tryParseMecp('MECP/2/D01 M01');
    expect(drill).not.toBeNull();
    expect(isMecpDrill(drill!)).toBe(true);
    const d03 = tryParseMecp('MECP/2/D03 M01');
    expect(d03).not.toBeNull();
    expect(isMecpDrill(d03!)).toBe(false);
  });

  it('rejects non-MECP', () => {
    expect(tryParseMecp('not mecp')).toBeNull();
    expect(isMecpMessage('MECP/x/M01')).toBe(false);
  });
});

describe('extractMecpCoords', () => {
  it('parses bare and #-prefixed lat,lon', () => {
    expect(extractMecpCoords('2pax 48.65,20.13 trail')).toEqual({ lat: 48.65, lon: 20.13 });
    expect(extractMecpCoords('#-33.8688,151.2093')).toEqual({ lat: -33.8688, lon: 151.2093 });
  });

  it('returns null when absent or out of range', () => {
    expect(extractMecpCoords('')).toBeNull();
    expect(extractMecpCoords('2pax near ridge')).toBeNull();
    expect(extractMecpCoords('95.1,20.2')).toBeNull();
    expect(extractMecpCoords('45.1,190.2')).toBeNull();
  });

  it('agrees with the decoder GPS extraction', () => {
    const parsed = tryParseMecp('MECP/0/M01 1pax 39.7392,-104.9903');
    expect(extractMecpCoords(parsed!.freetext!)).toEqual(parsed!.extracted.gps);
  });
});

describe('incidentFingerprint', () => {
  const base = { severity: 0, codes: ['M01', 'P05'], freetext: '2pax ridge', senderId: '!abcd' };

  it('is stable and order/whitespace/case-insensitive', () => {
    const a = incidentFingerprint(base);
    const b = incidentFingerprint({
      ...base,
      codes: ['P05', 'M01', 'M01'],
      freetext: '  2PAX   ridge ',
      senderId: '!ABCD',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^mecp-[0-9a-f]{14}$/);
  });

  it('differs for severity, codes, freetext, or sender changes', () => {
    const a = incidentFingerprint(base);
    expect(incidentFingerprint({ ...base, severity: 1 })).not.toBe(a);
    expect(incidentFingerprint({ ...base, codes: ['M01'] })).not.toBe(a);
    expect(incidentFingerprint({ ...base, freetext: '3pax ridge' })).not.toBe(a);
    expect(incidentFingerprint({ ...base, senderId: '!beef' })).not.toBe(a);
  });

  it('ignores GPS coordinates in freetext so updated position does not fork the id', () => {
    const a = incidentFingerprint({
      ...base,
      freetext: '2pax ridge 39.7,-105.0',
    });
    const b = incidentFingerprint({
      ...base,
      freetext: '2pax ridge 40.1,-104.5',
    });
    expect(a).toBe(b);
    expect(a).toBe(incidentFingerprint({ ...base, freetext: '2pax ridge' }));
  });
});

describe('encode / byte limit', () => {
  it('round-trips severity and codes', () => {
    const { message, overLimit, byteLength } = encode(1, ['T04'], '1pax');
    expect(message).toBe('MECP/1/T04 1pax');
    expect(overLimit).toBe(false);
    expect(byteLength).toBe(getByteLength(message));
    expect(byteLength).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    const parsed = tryParseMecp(message);
    expect(parsed?.severity).toBe(1);
    expect(parsed?.codes).toEqual(['T04']);
  });

  it('flags over-limit messages', () => {
    const long = 'x'.repeat(250);
    const { overLimit } = encode(3, ['L01'], long);
    expect(overLimit).toBe(true);
  });
});
