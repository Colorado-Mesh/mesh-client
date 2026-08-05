import { describe, expect, it } from 'vitest';

import {
  classifyReticulumVia,
  formatReticulumViaBadgeLabel,
  isReticulumVia,
  isReticulumViaLabel,
  mergeObservedReticulumEgressVias,
  messageTransportFromWire,
  resolveReticulumOutboundViaFromInterfaces,
  resolveReticulumOutboundViaFromPath,
} from './classifyReticulumVia';

describe('classifyReticulumVia', () => {
  it('maps RNode interfaces to rf', () => {
    expect(classifyReticulumVia('rnode')).toBe('rf');
    expect(classifyReticulumVia('RNodeInterface')).toBe('rf');
    expect(classifyReticulumVia('My RNode LoRa')).toBe('rf');
  });

  it('maps BLE interfaces to ble', () => {
    expect(classifyReticulumVia('ble')).toBe('ble');
    expect(classifyReticulumVia('ble://AA:BB')).toBe('ble');
  });

  it('maps TCP interfaces to tcp', () => {
    expect(classifyReticulumVia('tcp')).toBe('tcp');
    expect(classifyReticulumVia('TCPClientInterface')).toBe('tcp');
  });

  it('maps auto and unknown interfaces to network', () => {
    expect(classifyReticulumVia('auto')).toBe('network');
    expect(classifyReticulumVia('AutoInterface')).toBe('network');
    expect(classifyReticulumVia('something-else')).toBe('network');
  });

  it('parses wire transport fields including multi-egress', () => {
    expect(messageTransportFromWire('rf', null, 'inbound')).toBe('rf');
    expect(messageTransportFromWire(null, 'tcp', 'outbound')).toBe('tcp');
    expect(messageTransportFromWire(null, 'rf+tcp', 'outbound')).toBe('rf+tcp');
    expect(messageTransportFromWire('paper', null, 'inbound')).toBe('paper');
    expect(messageTransportFromWire(null, 'paper', 'outbound')).toBe('paper');
    expect(isReticulumVia('network')).toBe(true);
    expect(isReticulumVia('mqtt')).toBe(false);
    expect(isReticulumViaLabel('rf+tcp')).toBe(true);
    expect(isReticulumViaLabel('both')).toBe(false);
  });

  it('resolveReticulumOutboundViaFromInterfaces prefers enabled RNode over TCP', () => {
    expect(
      resolveReticulumOutboundViaFromInterfaces([
        { type: 'tcp', enabled: true },
        { type: 'rnode', enabled: true },
      ]),
    ).toBe('rf');
  });

  it('resolveReticulumOutboundViaFromInterfaces classifies ble:// RNode as ble', () => {
    expect(
      resolveReticulumOutboundViaFromInterfaces([
        { type: 'rnode', enabled: true, serial_port: 'ble://AA:BB:CC:DD:EE:FF' },
        { type: 'tcp', enabled: true },
      ]),
    ).toBe('ble');
  });

  it('resolveReticulumOutboundViaFromInterfaces skips disabled interfaces', () => {
    expect(
      resolveReticulumOutboundViaFromInterfaces([
        { type: 'rnode', enabled: false },
        { type: 'tcp', enabled: true },
      ]),
    ).toBe('tcp');
  });

  it('resolveReticulumOutboundViaFromInterfaces prefers primary local serial RNode', () => {
    expect(
      resolveReticulumOutboundViaFromInterfaces(
        [
          { id: 'first', type: 'rnode', enabled: true },
          { id: 'second', type: 'rnode', enabled: true },
        ],
        'second',
      ),
    ).toBe('rf');
  });

  it('resolveReticulumOutboundViaFromInterfaces falls back to network', () => {
    expect(resolveReticulumOutboundViaFromInterfaces([{ type: 'auto', enabled: true }])).toBe(
      'network',
    );
  });

  it('resolveReticulumOutboundViaFromPath prefers path-table interface over local RNode', () => {
    expect(
      resolveReticulumOutboundViaFromPath(
        'RNS Testnet',
        [
          { id: 'heltec', name: 'Heltec V3', type: 'rnode', enabled: true },
          { id: 'tcp', name: 'RNS Testnet', type: 'tcp', enabled: true },
        ],
        null,
      ),
    ).toBe('tcp');
  });

  it('mergeObservedReticulumEgressVias joins explicit atoms and never both', () => {
    expect(mergeObservedReticulumEgressVias(['rf'])).toBe('rf');
    expect(mergeObservedReticulumEgressVias(['tcp', 'rf'])).toBe('rf+tcp');
    expect(mergeObservedReticulumEgressVias(['both', 'mqtt'])).toBe('network');
    expect(formatReticulumViaBadgeLabel('rf+tcp')).toBe('RF+TCP');
    expect(formatReticulumViaBadgeLabel('ble')).toBe('BLE');
  });
});
