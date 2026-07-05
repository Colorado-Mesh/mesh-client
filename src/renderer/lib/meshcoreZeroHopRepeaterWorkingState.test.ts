/**
 * KNOWN-GOOD WORKING STATE — MeshCore 0-hop repeater admin (Ping / Status / Neighbors / Telemetry)
 *
 * These tests document the verified working contract from debug session 5bf576.
 * DO NOT change the underlying behavior or these assertions unless the user explicitly
 * requests it. AI assistants must treat failures here as regressions, not invitations
 * to "simplify" timeouts, remove serialization, or reintroduce login gates.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MESHCORE_NEIGHBORS_TIMEOUT_MS,
  MESHCORE_STATUS_TIMEOUT_MS,
  MESHCORE_TELEMETRY_TIMEOUT_MS,
} from '../hooks/meshcore/meshcoreHookPreamble';
import { extractUseCallbackBody } from './sourceContractTestHelpers';
import {
  MESHCORE_REPEATER_PING_SETTLE_MAX_MS,
  MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS,
  meshcoreRepeaterRpcTimeoutMs,
} from './timeConstants';

const AI_GUARD = 'KNOWN-GOOD 0-hop repeater admin — do not change without explicit user request';

const RUNTIME_SOURCE = readFileSync(join(__dirname, '../runtime/useMeshcoreRuntime.ts'), 'utf-8');
const TRACE_IDLE_SOURCE = readFileSync(join(__dirname, 'meshcoreTraceRadioIdle.ts'), 'utf-8');
const QUEUED_SEND_SOURCE = readFileSync(
  join(__dirname, 'meshcoreRepeaterRpcQueuedSend.ts'),
  'utf-8',
);
const RADIO_SENT_WAIT_SOURCE = readFileSync(join(__dirname, 'meshcoreRadioSentWait.ts'), 'utf-8');
const PREFIX_PUSH_SOURCE = readFileSync(
  join(__dirname, 'meshcoreRepeaterPrefixPushRpc.ts'),
  'utf-8',
);
const STATUS_RPC_SOURCE = readFileSync(join(__dirname, 'meshcoreRepeaterStatusRpc.ts'), 'utf-8');
const TELEMETRY_RPC_SOURCE = readFileSync(
  join(__dirname, 'meshcoreRepeaterTelemetryRpc.ts'),
  'utf-8',
);
const BINARY_RPC_SOURCE = readFileSync(
  join(__dirname, 'meshcoreRepeaterBinaryRequestRpc.ts'),
  'utf-8',
);
const IN_FLIGHT_SOURCE = readFileSync(join(__dirname, 'meshcoreRepeaterRpcInFlight.ts'), 'utf-8');
const TRACE_PATH_SOURCE = readFileSync(join(__dirname, 'meshcoreRepeaterTracePath.ts'), 'utf-8');

describe(`meshcore 0-hop repeater working state (${AI_GUARD})`, () => {
  it('uses flat 120s timeouts for status, telemetry, and neighbors (not hop-scaled 30s)', () => {
    expect(MESHCORE_STATUS_TIMEOUT_MS).toBe(120_000);
    expect(MESHCORE_TELEMETRY_TIMEOUT_MS).toBe(120_000);
    expect(MESHCORE_NEIGHBORS_TIMEOUT_MS).toBe(120_000);
    expect(meshcoreRepeaterRpcTimeoutMs(0)).toBe(30_000);
    expect(MESHCORE_STATUS_TIMEOUT_MS).toBeGreaterThan(meshcoreRepeaterRpcTimeoutMs(0));
  });

  it('ping end-to-end cap is 180s with ping-settle budget of 2× that for admin RPCs', () => {
    expect(MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS).toBe(180_000);
    expect(MESHCORE_REPEATER_PING_SETTLE_MAX_MS).toBe(2 * MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS);
  });

  it('queued send releases companion queue at RESP_SENT (response wait is outside queue)', () => {
    expect(QUEUED_SEND_SOURCE).toContain('Hold the companion RPC queue only until `RESP_SENT`');
    expect(QUEUED_SEND_SOURCE).toContain('Response waits must run outside this helper');
    expect(QUEUED_SEND_SOURCE).toContain('waitForMeshcoreRadioSentAck');
    expect(RADIO_SENT_WAIT_SOURCE).toContain('MESHCORE_TRACE_SENT_WAIT_TIMEOUT_MS');
  });

  it('status, telemetry, and neighbors use pubkey-framed RPCs with beforeSend idle hook', () => {
    expect(STATUS_RPC_SOURCE).toContain('runMeshcoreRepeaterPrefixPushRequest');
    expect(TELEMETRY_RPC_SOURCE).toContain('runMeshcoreRepeaterPrefixPushRequest');
    expect(PREFIX_PUSH_SOURCE).toContain('runMeshcoreRepeaterQueuedSend');
    expect(BINARY_RPC_SOURCE).toContain('runMeshcoreRepeaterQueuedSend');
    expect(PREFIX_PUSH_SOURCE).toContain('beforeSend');
    expect(BINARY_RPC_SOURCE).toContain('beforeSend');
  });

  it('admin beforeSend waits only for TraceData (traceResponses), not pendingRoutes', () => {
    expect(TRACE_IDLE_SOURCE).toContain('wait only for active TraceData responses');
    expect(TRACE_IDLE_SOURCE).toContain('do not wait on');
    expect(TRACE_IDLE_SOURCE).toContain('pending route registration');
    expect(TRACE_IDLE_SOURCE).toMatch(
      /awaitMeshcoreRepeaterAdminRfIdle[\s\S]*awaitMeshcoreTraceRadioIdle/,
    );
    expect(TRACE_IDLE_SOURCE).not.toMatch(
      /awaitMeshcoreRepeaterAdminRfIdle[\s\S]*while\s*\([\s\S]*meshcoreTracePendingRouteCount/,
    );
  });

  it('runtime awaits same-node ping settle before status, telemetry, and neighbors', () => {
    const statusBody = extractUseCallbackBody(RUNTIME_SOURCE, 'requestRepeaterStatus');
    const telemetryBody = extractUseCallbackBody(RUNTIME_SOURCE, 'requestTelemetry');
    const neighborsBody = extractUseCallbackBody(RUNTIME_SOURCE, 'requestNeighbors');
    expect(statusBody).toContain('awaitMeshcoreRepeaterPingSettleForNode');
    expect(telemetryBody).toContain('awaitMeshcoreRepeaterPingSettleForNode');
    expect(neighborsBody).toContain('awaitMeshcoreRepeaterPingSettleForNode');
  });

  it('serializes admin RPCs per repeater node via runMeshcoreRepeaterRpcOnce', () => {
    expect(IN_FLIGHT_SOURCE).toContain('adminQueueTailByNode');
    expect(IN_FLIGHT_SOURCE).toContain("if (kind === 'trace')");
    const statusBody = extractUseCallbackBody(RUNTIME_SOURCE, 'requestRepeaterStatus');
    const neighborsBody = extractUseCallbackBody(RUNTIME_SOURCE, 'requestNeighbors');
    expect(statusBody).toContain("runMeshcoreRepeaterRpcOnce('status'");
    expect(neighborsBody).toContain("runMeshcoreRepeaterRpcOnce('neighbors'");
  });

  it('0-hop ping seeds 1-byte path and may direct-retry with full pubkey after cancel settles', () => {
    expect(TRACE_PATH_SOURCE).toContain('meshcoreTraceDirectRetryEligible');
    expect(TRACE_PATH_SOURCE).toContain('1-byte pubkey prefix');
    const traceBody = extractUseCallbackBody(RUNTIME_SOURCE, 'traceRoute');
    expect(traceBody).toContain('meshcoreTraceDirectRetryEligible');
    expect(traceBody).toContain("firstTrace.cancel('superseded or timed out')");
    expect(traceBody).toContain('await firstTrace.promise');
    expect(traceBody).toContain('new Uint8Array(pubKey)');
    expect(traceBody).toContain('meshcoreTracePingDirectRetry');
  });

  it('passes awaitMeshcoreRepeaterAdminRfIdle as beforeSend to admin RPC helpers', () => {
    const statusBody = extractUseCallbackBody(RUNTIME_SOURCE, 'requestRepeaterStatus');
    const telemetryBody = extractUseCallbackBody(RUNTIME_SOURCE, 'requestTelemetry');
    const neighborsBody = extractUseCallbackBody(RUNTIME_SOURCE, 'requestNeighbors');
    expect(statusBody).toContain('awaitMeshcoreRepeaterAdminRfIdle');
    expect(telemetryBody).toContain('awaitMeshcoreRepeaterAdminRfIdle');
    expect(neighborsBody).toContain('awaitMeshcoreRepeaterAdminRfIdle');
  });
});
