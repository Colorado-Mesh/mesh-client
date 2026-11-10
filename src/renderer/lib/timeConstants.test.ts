import { describe, expect, it } from 'vitest';

import {
  MESHCORE_REPEATER_REPLY_CAP_MS,
  MESHCORE_REPEATER_RPC_TIMEOUT_BASE_MS,
  MESHCORE_REPEATER_RPC_TIMEOUT_CAP_MS,
  meshcoreRepeaterReplyWaitMs,
  meshcoreRepeaterRpcTimeoutMs,
} from './timeConstants';

describe('meshcoreRepeaterRpcTimeoutMs', () => {
  it('returns base timeout for 0 hops', () => {
    expect(meshcoreRepeaterRpcTimeoutMs(0)).toBe(MESHCORE_REPEATER_RPC_TIMEOUT_BASE_MS);
    expect(meshcoreRepeaterRpcTimeoutMs(null)).toBe(MESHCORE_REPEATER_RPC_TIMEOUT_BASE_MS);
  });

  it('scales with hop count', () => {
    expect(meshcoreRepeaterRpcTimeoutMs(3)).toBe(45_000);
  });

  it('caps at MESHCORE_REPEATER_RPC_TIMEOUT_CAP_MS for distant repeaters', () => {
    expect(meshcoreRepeaterRpcTimeoutMs(13)).toBe(MESHCORE_REPEATER_RPC_TIMEOUT_CAP_MS);
    expect(meshcoreRepeaterRpcTimeoutMs(100)).toBe(MESHCORE_REPEATER_RPC_TIMEOUT_CAP_MS);
  });
});

describe('meshcoreRepeaterReplyWaitMs', () => {
  it('clamps est + grace into floor/cap', () => {
    expect(meshcoreRepeaterReplyWaitMs({ estTimeoutMs: 4_000 })).toBe(15_000);
    expect(meshcoreRepeaterReplyWaitMs({ estTimeoutMs: 40_000 })).toBe(45_000);
    expect(meshcoreRepeaterReplyWaitMs({ estTimeoutMs: 100_000 })).toBe(
      MESHCORE_REPEATER_REPLY_CAP_MS,
    );
  });

  it('falls back to hop-scaled planned timeout when est is missing', () => {
    expect(meshcoreRepeaterReplyWaitMs({ hopsAway: 0 })).toBe(30_000);
    expect(meshcoreRepeaterReplyWaitMs({ hopsAway: 3 })).toBe(45_000);
    expect(meshcoreRepeaterReplyWaitMs({ hopsAway: 20 })).toBe(MESHCORE_REPEATER_REPLY_CAP_MS);
  });
});
