import { describe, expect, it } from 'vitest';

import {
  MESHCORE_REPEATER_RPC_TIMEOUT_BASE_MS,
  MESHCORE_REPEATER_RPC_TIMEOUT_CAP_MS,
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
