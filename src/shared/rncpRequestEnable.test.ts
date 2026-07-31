import { describe, expect, it } from 'vitest';

import {
  buildRncpReceiveDestShareBody,
  buildRncpRequestEnableMessageBody,
  lxmfBodyContainsRncpRequestEnable,
  parseRncpReceiveDestShare,
  RNCP_RECEIVE_DEST_SHARE_PREFIX,
  RNCP_REQUEST_ENABLE_SENTINEL,
} from './rncpRequestEnable';

describe('rncpRequestEnable', () => {
  it('returns human instructions only (no mesh-client sentinel)', () => {
    const body = buildRncpRequestEnableMessageBody('Please enable file receiving.');
    expect(body).toBe('Please enable file receiving.');
    expect(body).not.toContain(RNCP_REQUEST_ENABLE_SENTINEL);
  });

  it('detects sentinel in inbound body', () => {
    expect(lxmfBodyContainsRncpRequestEnable(`hi\n${RNCP_REQUEST_ENABLE_SENTINEL}`)).toBe(true);
    expect(lxmfBodyContainsRncpRequestEnable('ordinary chat')).toBe(false);
    expect(lxmfBodyContainsRncpRequestEnable(null)).toBe(false);
  });

  it('builds and parses receive-dest share bodies with a plain hash line', () => {
    const hash = 'ab'.repeat(16);
    const body = buildRncpReceiveDestShareBody('Here is my rncp receive destination.', hash);
    expect(body).toContain(`Here is my rncp receive destination.\n${hash}`);
    expect(body).toContain(RNCP_RECEIVE_DEST_SHARE_PREFIX + hash);
    expect(parseRncpReceiveDestShare(body)).toBe(hash);
  });

  it('parseRncpReceiveDestShare returns null for ordinary chat', () => {
    expect(parseRncpReceiveDestShare('hello')).toBeNull();
    expect(parseRncpReceiveDestShare(null)).toBeNull();
    expect(parseRncpReceiveDestShare(`${RNCP_RECEIVE_DEST_SHARE_PREFIX}short`)).toBeNull();
  });

  it('buildRncpReceiveDestShareBody rejects invalid hashes', () => {
    expect(() => buildRncpReceiveDestShareBody('x', 'nope')).toThrow('invalid_rncp_receive_hash');
  });
});
