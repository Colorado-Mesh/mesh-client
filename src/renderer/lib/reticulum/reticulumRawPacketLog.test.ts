import { describe, expect, it } from 'vitest';

import { formatReticulumWireEnumLabel, reticulumWireRowToEntry } from './reticulumRawPacketLog';

describe('reticulumRawPacketLog', () => {
  it('converts sidecar wire row to entry bytes', () => {
    const entry = reticulumWireRowToEntry({
      ts: 1000,
      direction: 'rx',
      interface_id: 2,
      interface_name: 'RNode',
      raw_hex: 'deadbeef',
      rssi: -90,
      snr: 4.5,
      q: null,
      packet_type: 'Announce',
      header_type: 'Header1',
      destination_hash: 'abc',
      transport_type: 'Broadcast',
      context: 'None',
    });
    expect(entry.raw).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    expect(entry.direction).toBe('rx');
    expect(entry.interfaceName).toBe('RNode');
  });

  it('formats enum debug strings', () => {
    expect(formatReticulumWireEnumLabel('PacketType::Announce')).toBe('Announce');
    expect(formatReticulumWireEnumLabel('PacketType(Announce)')).toBe('Announce');
  });
});
