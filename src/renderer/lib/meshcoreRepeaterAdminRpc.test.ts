import { describe, expect, it } from 'vitest';

import {
  MESHCORE_NEIGHBORS_TIMEOUT_MS,
  MESHCORE_STATUS_TIMEOUT_MS,
  MESHCORE_TELEMETRY_TIMEOUT_MS,
} from '../hooks/meshcore/meshcoreHookPreamble';
import { meshcoreRepeaterRpcTimeoutMs } from './timeConstants';

/**
 * Contract tests for repeater admin RPC timing and hop semantics (issue #599 / debug session).
 * Status, telemetry, and neighbors use pubkey-framed RPCs — no radio contact-list gate.
 * Ping/trace uses hashed path bytes; 0-hop may escalate to full pubkey on direct retry only.
 */
describe('meshcore repeater admin RPC contracts', () => {
  it('0-hop status/telemetry use flat 120s repeater RPC timeout', () => {
    expect(MESHCORE_STATUS_TIMEOUT_MS).toBe(120_000);
    expect(MESHCORE_TELEMETRY_TIMEOUT_MS).toBe(120_000);
    expect(meshcoreRepeaterRpcTimeoutMs(0)).toBe(30_000);
  });

  it('neighbors uses the legacy 120s flat timeout (not hop-scaled 30s)', () => {
    expect(MESHCORE_NEIGHBORS_TIMEOUT_MS).toBe(120_000);
    expect(MESHCORE_NEIGHBORS_TIMEOUT_MS).toBeGreaterThan(meshcoreRepeaterRpcTimeoutMs(0));
  });

  it('multi-hop RPC timeout scales with hops', () => {
    expect(meshcoreRepeaterRpcTimeoutMs(1)).toBe(35_000);
    expect(meshcoreRepeaterRpcTimeoutMs(3)).toBe(45_000);
  });
});
