import { describe, expect, it } from 'vitest';

import { parseMeshcoreRoomAclResponse } from './meshcoreRoomAclParser';

describe('parseMeshcoreRoomAclResponse', () => {
  it('parses pubkey and permission from typical lines', () => {
    const fullKey = 'a'.repeat(64);
    const text = `OK\n${fullKey}: 2\n11223344:1`;
    const entries = parseMeshcoreRoomAclResponse(text);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.permissionLevel).toBe(2);
    expect(entries[0]?.pubkeyPrefix).toBe(false);
    expect(entries[1]?.pubkeyHex).toBe('11223344');
    expect(entries[1]?.pubkeyPrefix).toBe(true);
  });

  it('returns empty for blank or error-only output', () => {
    expect(parseMeshcoreRoomAclResponse('')).toEqual([]);
    expect(parseMeshcoreRoomAclResponse('[Error: timeout]')).toEqual([]);
  });
});
