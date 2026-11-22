import { describe, expect, it } from 'vitest';

import {
  MESHCOM_WIRE_MAX_BYTES,
  meshcomAddressOverheadBytes,
  meshcomAddressPrefix,
  meshcomBodyBudgetBytes,
  meshcomBodyBudgetForChat,
  truncateToWireBytes,
} from './meshcomWireLimits';

describe('meshcomWireLimits', () => {
  it('uses no address prefix for ALL', () => {
    expect(meshcomAddressPrefix('*')).toBe('');
    expect(meshcomAddressOverheadBytes('*')).toBe(0);
    expect(meshcomBodyBudgetBytes('*')).toBe(MESHCOM_WIRE_MAX_BYTES);
  });

  it('reserves UTF-8 bytes for GRC and callsign prefixes', () => {
    expect(meshcomAddressPrefix('260')).toBe('{260}');
    expect(meshcomAddressOverheadBytes('260')).toBe(5);
    expect(meshcomBodyBudgetBytes('260')).toBe(155);

    expect(meshcomAddressPrefix('SP5DH-1')).toBe('{SP5DH-1}');
    expect(meshcomAddressOverheadBytes('SP5DH-1')).toBe(9);
    expect(meshcomBodyBudgetBytes('SP5DH-1')).toBe(151);
  });

  it('clamps EXTUDP body to 150 when requested', () => {
    expect(meshcomBodyBudgetBytes('*', { capExtUdp: true })).toBe(150);
    expect(meshcomBodyBudgetBytes('260', { capExtUdp: true })).toBe(150);
  });

  it('resolves chat channel / DM destinations', () => {
    expect(meshcomBodyBudgetForChat({ channelIndex: 0 })).toBe(160);
    expect(meshcomBodyBudgetForChat({ channelIndex: 260 })).toBe(155);
    expect(meshcomBodyBudgetForChat({ destinationCallsign: 'SP5DH-1' })).toBe(151);
  });

  it('truncates multi-byte text to the wire budget', () => {
    // Polish 'ą' is 2 UTF-8 bytes; 80 of them = 160 bytes → fits ALL; 81 does not.
    const eighty = 'ą'.repeat(80);
    expect(truncateToWireBytes(eighty, 160)).toBe(eighty);
    expect(truncateToWireBytes('ą'.repeat(81), 160)).toBe(eighty);
  });
});
