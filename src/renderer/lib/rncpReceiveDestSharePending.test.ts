import { afterEach, describe, expect, it } from 'vitest';

import {
  consumeRncpReceiveDestSharePending,
  hasRncpReceiveDestSharePending,
  markRncpReceiveDestSharePending,
  resetRncpReceiveDestSharePendingForTests,
  RNCP_RECEIVE_DEST_SHARE_PENDING_TTL_MS,
} from './rncpReceiveDestSharePending';

const PEER = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('rncpReceiveDestSharePending', () => {
  afterEach(() => {
    resetRncpReceiveDestSharePendingForTests();
  });

  it('requires a prior mark before consume succeeds', () => {
    expect(consumeRncpReceiveDestSharePending(PEER)).toBe(false);
    markRncpReceiveDestSharePending(PEER);
    expect(hasRncpReceiveDestSharePending(PEER)).toBe(true);
    expect(consumeRncpReceiveDestSharePending(PEER)).toBe(true);
    expect(consumeRncpReceiveDestSharePending(PEER)).toBe(false);
  });

  it('rejects after TTL', () => {
    const now = 1_000_000;
    markRncpReceiveDestSharePending(PEER, now);
    expect(
      consumeRncpReceiveDestSharePending(PEER, now + RNCP_RECEIVE_DEST_SHARE_PENDING_TTL_MS + 1),
    ).toBe(false);
  });

  it('rejects invalid peer hashes', () => {
    markRncpReceiveDestSharePending('short');
    expect(hasRncpReceiveDestSharePending('short')).toBe(false);
  });
});
