import { describe, expect, it } from 'vitest';

import { RNode, RNODE_COMMAND_TIMEOUT_MS } from './rnode';

describe('RNode command timeouts', () => {
  it('exports a positive default KISS command timeout', () => {
    expect(RNODE_COMMAND_TIMEOUT_MS).toBeGreaterThan(5_000);
  });
});

describe('RNode WiFi payloads', () => {
  it('nullableStringPayload matches rnodeconf shapes', () => {
    expect(RNode.nullableStringPayload('')).toEqual([0]);
    expect(RNode.nullableStringPayload('RNode')).toEqual([...new TextEncoder().encode('RNode'), 0]);
  });

  it('ipv4Payload parses dotted quads', () => {
    expect(RNode.ipv4Payload('192.168.1.10')).toEqual([192, 168, 1, 10]);
    expect(() => RNode.ipv4Payload('bad')).toThrow('invalid IPv4 address');
  });
});
