import { describe, expect, it } from 'vitest';

import { emptyNode } from './useDevice';

describe('emptyNode', () => {
  it('generates a long_name as the hex node ID with ! prefix', () => {
    const node = emptyNode(0xabcd1234);
    expect(node.long_name).toBe('!abcd1234');
  });

  it('generates a short_name from the last 4 hex characters', () => {
    const node = emptyNode(0xabcd1234);
    expect(node.short_name).toBe('1234');
  });

  it('zero-pads node IDs shorter than 8 hex digits', () => {
    const node = emptyNode(0x0000007f);
    expect(node.long_name).toBe('!0000007f');
    expect(node.short_name).toBe('007f');
  });

  it('handles the maximum 32-bit node ID', () => {
    const node = emptyNode(0xffffffff);
    expect(node.long_name).toBe('!ffffffff');
    expect(node.short_name).toBe('ffff');
  });

  it('sets node_id correctly', () => {
    const node = emptyNode(0x12345678);
    expect(node.node_id).toBe(0x12345678);
  });

  it('initializes numeric fields to zero', () => {
    const node = emptyNode(0x1);
    expect(node.snr).toBe(0);
    expect(node.battery).toBe(0);
    expect(node.last_heard).toBe(0);
    expect(node.latitude).toBe(0);
    expect(node.longitude).toBe(0);
  });

  it('produces different names for different node IDs', () => {
    const a = emptyNode(0xaaaaaaaa);
    const b = emptyNode(0xbbbbbbbb);
    expect(a.long_name).not.toBe(b.long_name);
    expect(a.short_name).not.toBe(b.short_name);
  });
});
