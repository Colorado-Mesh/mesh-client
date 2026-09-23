import { describe, expect, it } from 'vitest';

import {
  encode,
  getByteLength,
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
