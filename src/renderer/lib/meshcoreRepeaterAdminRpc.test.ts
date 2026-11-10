import { describe, expect, it } from 'vitest';

import {
  MESHCORE_NEIGHBORS_TIMEOUT_MS,
  MESHCORE_STATUS_TIMEOUT_MS,
  MESHCORE_TELEMETRY_TIMEOUT_MS,
} from '../hooks/meshcore/meshcoreHookPreamble';
import {
  MESHCORE_REPEATER_REPLY_CAP_MS,
  meshcoreRepeaterReplyWaitMs,
  meshcoreRepeaterRpcTimeoutMs,
} from './timeConstants';

/**
 * Contract tests for repeater admin RPC timing and hop semantics.
 * Status, telemetry, and neighbors use pubkey-framed RPCs — no radio contact-list gate.
 * Ping/trace uses hashed path bytes; 0-hop may escalate to full pubkey on direct retry only.
 */
describe('meshcore repeater admin RPC contracts', () => {
  it('status/telemetry/neighbors export the 60s reply hard cap', () => {
    expect(MESHCORE_STATUS_TIMEOUT_MS).toBe(MESHCORE_REPEATER_REPLY_CAP_MS);
    expect(MESHCORE_TELEMETRY_TIMEOUT_MS).toBe(MESHCORE_REPEATER_REPLY_CAP_MS);
    expect(MESHCORE_NEIGHBORS_TIMEOUT_MS).toBe(MESHCORE_REPEATER_REPLY_CAP_MS);
    expect(meshcoreRepeaterRpcTimeoutMs(0)).toBe(30_000);
  });

  it('receipt-derived wait never uses flat est+120s', () => {
    expect(meshcoreRepeaterReplyWaitMs({ estTimeoutMs: 4_000, hopsAway: 3 })).toBeLessThan(30_000);
    expect(meshcoreRepeaterReplyWaitMs({ estTimeoutMs: 4_000, hopsAway: 3 })).toBe(15_000);
  });

  it('multi-hop RPC timeout scales with hops', () => {
    expect(meshcoreRepeaterRpcTimeoutMs(1)).toBe(35_000);
    expect(meshcoreRepeaterRpcTimeoutMs(3)).toBe(45_000);
  });
});
