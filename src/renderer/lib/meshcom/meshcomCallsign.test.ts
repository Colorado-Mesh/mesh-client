import { describe, expect, it } from 'vitest';

import {
  callsignToNodeId,
  isMeshcomLegacyBroadcastPlaceholder,
  isMeshcomNodeIdPlaceholderCallsign,
  MESHCOM_SRC_PATH_MAX_CALLS,
  meshcomCallsignSoftWarn,
  meshcomNodeIdPlaceholderCallsign,
  normalizeMeshcomCallsign,
  normalizeMeshcomSrcPath,
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

  it('treats N{hex(nodeId)} as placeholder provenance without rejecting N0ABC', () => {
    expect(meshcomNodeIdPlaceholderCallsign(0xffffffff)).toBe('NFFFFFFFF');
    expect(isMeshcomLegacyBroadcastPlaceholder('NFFFFFFFF')).toBe(true);
    expect(isMeshcomLegacyBroadcastPlaceholder('N0ABC')).toBe(false);

    const n0abcId = callsignToNodeId('N0ABC');
    expect(isMeshcomNodeIdPlaceholderCallsign('N0ABC', n0abcId)).toBe(false);
    expect(
      isMeshcomNodeIdPlaceholderCallsign(meshcomNodeIdPlaceholderCallsign(0xcd5305e1), 0xcd5305e1),
    ).toBe(true);
  });

  it('parses digipeater paths into origin and hop count', () => {
    expect(parseMeshcomSrcPath('OE1KFR-1,DH1FR-2,OE1ABC-1')).toEqual({
      origin: 'OE1KFR-1',
      digis: ['DH1FR-2', 'OE1ABC-1'],
      hopCount: 2,
    });
    expect(parseMeshcomSrcPath('')).toEqual({ origin: '', digis: [], hopCount: 0 });
  });

  it('normalizes digipeater paths hop-by-hop without mangling (#1582)', () => {
    // Single-callsign normalize+clamp used to turn this into IK5NJM11IW5.
    expect(normalizeMeshcomSrcPath('IK5NJM-11,IW5EIA-12')).toBe('IK5NJM-11,IW5EIA-12');
    expect(normalizeMeshcomSrcPath(' ik5njm-11 , iw5eia-02 ')).toBe('IK5NJM-11,IW5EIA-2');
    expect(normalizeMeshcomSrcPath('OE1KFR-1')).toBe('OE1KFR-1');
    expect(normalizeMeshcomSrcPath('')).toBe('');
    expect(parseMeshcomSrcPath('IK5NJM-11,IW5EIA-12')).toEqual({
      origin: 'IK5NJM-11',
      digis: ['IW5EIA-12'],
      hopCount: 1,
    });
  });

  it('caps digipeater path length at origin + 8 hops', () => {
    const hops = Array.from({ length: MESHCOM_SRC_PATH_MAX_CALLS + 3 }, (_, i) => `AA${i}-1`);
    const parsed = parseMeshcomSrcPath(hops.join(','));
    expect(parsed.origin).toBe('AA0-1');
    expect(parsed.digis).toHaveLength(MESHCOM_SRC_PATH_MAX_CALLS - 1);
    expect(parsed.hopCount).toBe(MESHCOM_SRC_PATH_MAX_CALLS - 1);
    expect(normalizeMeshcomSrcPath(hops.join(',')).split(',')).toHaveLength(
      MESHCOM_SRC_PATH_MAX_CALLS,
    );
  });
});
