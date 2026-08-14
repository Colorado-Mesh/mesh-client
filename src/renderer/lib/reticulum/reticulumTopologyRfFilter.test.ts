import { describe, expect, it } from 'vitest';

import {
  filterReticulumTopologyRfOnly,
  isReticulumTopologyInterfaceRf,
  isReticulumTopologyPeerRf,
} from './reticulumTopologyRfFilter';

describe('isReticulumTopologyInterfaceRf', () => {
  it.each([
    { name: 'rnode type', iface: { id: '1', name: 'Radio', type: 'rnode' } },
    { name: 'RNodeInterface type', iface: { id: '1', name: 'Radio', type: 'RNodeInterface' } },
    { name: 'rnode_multi type', iface: { id: '1', name: 'Multi', type: 'rnode_multi' } },
    { name: 'kiss type', iface: { id: '1', name: 'TNC', type: 'kiss' } },
    {
      name: 'USB RNode',
      iface: { id: '1', name: 'RNode USB', type: 'rnode', serial_port: '/dev/ttyUSB0' },
    },
    {
      name: 'BLE RNode',
      iface: { id: '1', name: 'RNode BLE', type: 'rnode', serial_port: 'ble://AA:BB:CC:DD:EE:FF' },
    },
    {
      name: 'Wi-Fi RNode',
      iface: { id: '1', name: 'RNode WiFi', type: 'rnode', serial_port: 'tcp://192.168.1.50' },
    },
    { name: 'BLE Peer', iface: { id: '1', name: 'Peer', type: 'ble_peer' } },
  ])('keeps $name as RF', ({ iface }) => {
    expect(isReticulumTopologyInterfaceRf(iface)).toBe(true);
  });

  it.each([
    { name: 'TCP hub', iface: { id: '1', name: 'RNS_Transport_US-East', type: 'tcp' } },
    { name: 'I2P', iface: { id: '1', name: 'I2P', type: 'i2p' } },
    { name: 'AutoInterface', iface: { id: '1', name: 'Default Interface', type: 'auto' } },
  ])('drops $name', ({ iface }) => {
    expect(isReticulumTopologyInterfaceRf(iface)).toBe(false);
  });
});

describe('isReticulumTopologyPeerRf', () => {
  it('classifies path-table names via configured rows', () => {
    const ifaces = [
      { id: 'rnode-1', name: 'RNode 41F4', type: 'rnode' },
      { id: 'tcp-east', name: 'RNS_Transport_US-East', type: 'tcp' },
    ];
    expect(isReticulumTopologyPeerRf({ interface: 'RNode 41F4' }, ifaces)).toBe(true);
    expect(isReticulumTopologyPeerRf({ interface: 'RNS_Transport_US-East' }, ifaces)).toBe(false);
    expect(isReticulumTopologyPeerRf({ interface: 'unknown_iface' }, ifaces)).toBe(false);
    expect(isReticulumTopologyPeerRf({ interface: null }, ifaces)).toBe(false);
  });

  it('does not keep a TCP path whose name merely contains an RF iface token', () => {
    const ifaces = [{ id: 'rnode-1', name: 'RNode', type: 'rnode' }];
    expect(isReticulumTopologyPeerRf({ interface: 'RNode' }, ifaces)).toBe(true);
    expect(isReticulumTopologyPeerRf({ interface: 'RNode_TCP_East' }, ifaces)).toBe(false);
  });

  it('ignores empty and one-character interface names', () => {
    const ifaces = [{ id: 'rnode-1', name: 'R', type: 'rnode' }];
    expect(isReticulumTopologyPeerRf({ interface: 'Radio' }, ifaces)).toBe(false);
    expect(isReticulumTopologyPeerRf({ interface: 'R' }, ifaces)).toBe(false);
    expect(
      isReticulumTopologyPeerRf({ interface: 'anything' }, [{ id: 'x', name: '', type: 'rnode' }]),
    ).toBe(false);
  });
});

describe('filterReticulumTopologyRfOnly', () => {
  const rnode = { id: 'rnode-1', name: 'RNode 41F4', type: 'rnode' };
  const tcp = { id: 'tcp-east', name: 'RNS_Transport_US-East', type: 'tcp' };

  it('keeps RNode spokes and peers and drops TCP', () => {
    const { interfaces, peers } = filterReticulumTopologyRfOnly(
      [rnode, tcp],
      [
        { destination_hash: 'rfpeer', interface: 'RNode 41F4' },
        { destination_hash: 'tcppeer', interface: 'RNS_Transport_US-East' },
      ],
    );
    expect(interfaces.map((i) => i.id)).toEqual(['rnode-1']);
    expect(peers.map((p) => p.destination_hash)).toEqual(['rfpeer']);
  });

  it('drops unmatched Other paths peers', () => {
    const { peers } = filterReticulumTopologyRfOnly(
      [rnode],
      [{ destination_hash: 'orphan', interface: 'unknown_iface' }],
    );
    expect(peers).toEqual([]);
  });

  it('does not keep RNode_TCP_East when the RF iface is named RNode', () => {
    const { peers } = filterReticulumTopologyRfOnly(
      [{ id: 'rnode-1', name: 'RNode', type: 'rnode' }],
      [
        { destination_hash: 'rf', interface: 'RNode' },
        { destination_hash: 'tcp', interface: 'RNode_TCP_East' },
      ],
    );
    expect(peers.map((p) => p.destination_hash)).toEqual(['rf']);
  });

  it('returns no interfaces when nothing is RF', () => {
    const { interfaces, peers } = filterReticulumTopologyRfOnly(
      [tcp],
      [{ destination_hash: 'tcppeer', interface: 'RNS_Transport_US-East' }],
    );
    expect(interfaces).toEqual([]);
    expect(peers).toEqual([]);
  });
});
