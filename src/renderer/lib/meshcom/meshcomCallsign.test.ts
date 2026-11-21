import { describe, expect, it } from 'vitest';

import {
  callsignToNodeId,
  meshcomCallsignSoftWarn,
  normalizeMeshcomCallsign,
  parseMeshcomSrcPath,
} from './meshcomCallsign';

describe('meshcomCallsign', () => {
  it('normalizes case, SSID leading zeros, and clamps length', () => {
    expect(normalizeMeshcomCallsign(' oe1kfr-02 ')).toBe('OE1KFR-2');
    expect(normalizeMeshcomCallsign('dh1fr')).toBe('DH1FR');
    expect(normalizeMeshcomCallsign('')).toBe('');
  });

  it('soft-warns when the pattern is not callsign-SSID', () => {
    expect(meshcomCallsignSoftWarn('OE1KFR-2')).toBe(false);
    expect(meshcomCallsignSoftWarn('BAD')).toBe(true);
    expect(meshcomCallsignSoftWarn('')).toBe(true);
  });

  it('hashes callsigns to a stable non-zero node id', () => {
    const a = callsignToNodeId('OE1KFR-1');
    const b = callsignToNodeId('oe1kfr-1');
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
    expect(callsignToNodeId('')).toBe(0);
  });

  it('parses digipeater paths into origin and hop count', () => {
    expect(parseMeshcomSrcPath('OE1KFR-1,DH1FR-2,OE1ABC-1')).toEqual({
      origin: 'OE1KFR-1',
      digis: ['DH1FR-2', 'OE1ABC-1'],
      hopCount: 2,
    });
    expect(parseMeshcomSrcPath('')).toEqual({ origin: '', digis: [], hopCount: 0 });
  });
});
