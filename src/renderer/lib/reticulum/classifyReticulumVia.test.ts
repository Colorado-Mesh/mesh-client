import { describe, expect, it } from 'vitest';

import {
  classifyReticulumVia,
  isReticulumVia,
  messageTransportFromWire,
  resolveReticulumOutboundViaFromInterfaces,
} from './classifyReticulumVia';

describe('classifyReticulumVia', () => {
  it('maps RNode interfaces to rf', () => {
    expect(classifyReticulumVia('rnode')).toBe('rf');
    expect(classifyReticulumVia('RNodeInterface')).toBe('rf');
    expect(classifyReticulumVia('LoRa RNode')).toBe('rf');
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

  it('parses wire transport fields', () => {
    expect(messageTransportFromWire('rf', null, 'inbound')).toBe('rf');
    expect(messageTransportFromWire(null, 'tcp', 'outbound')).toBe('tcp');
    expect(isReticulumVia('network')).toBe(true);
    expect(isReticulumVia('mqtt')).toBe(false);
  });

  it('resolveReticulumOutboundViaFromInterfaces prefers enabled RNode over TCP', () => {
    expect(
      resolveReticulumOutboundViaFromInterfaces([
        { type: 'tcp', enabled: true },
        { type: 'rnode', enabled: true },
      ]),
    ).toBe('rf');
  });

  it('resolveReticulumOutboundViaFromInterfaces skips disabled interfaces', () => {
    expect(
      resolveReticulumOutboundViaFromInterfaces([
        { type: 'rnode', enabled: false },
        { type: 'tcp', enabled: true },
      ]),
    ).toBe('tcp');
  });

  it('resolveReticulumOutboundViaFromInterfaces falls back to network', () => {
    expect(resolveReticulumOutboundViaFromInterfaces([{ type: 'auto', enabled: true }])).toBe(
      'network',
    );
  });
});
