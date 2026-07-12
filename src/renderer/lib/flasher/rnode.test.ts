import { describe, expect, it } from 'vitest';

import { RNode, RNODE_BT_PAIRING_TIMEOUT_MS, RNODE_COMMAND_TIMEOUT_MS } from './rnode';

describe('RNode command timeouts', () => {
  it('exports positive default KISS and BT pairing timeouts', () => {
    expect(RNODE_COMMAND_TIMEOUT_MS).toBeGreaterThan(5_000);
    expect(RNODE_BT_PAIRING_TIMEOUT_MS).toBeGreaterThan(RNODE_COMMAND_TIMEOUT_MS);
  });

  it('wires sendCommand timeout cleanup in source', async () => {
    const source = await import('./rnode?raw');
    expect(source.default).toContain('RNODE_COMMAND_TIMEOUT');
    expect(source.default).toContain('this.callbacks.delete(command)');
    expect(source.default).toContain('RNODE_BT_PAIRING_TIMEOUT_MS');
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
