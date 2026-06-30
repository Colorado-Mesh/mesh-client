import { describe, expect, it } from 'vitest';

import {
  classifyReticulumVia,
  isReticulumVia,
  messageTransportFromWire,
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
});
