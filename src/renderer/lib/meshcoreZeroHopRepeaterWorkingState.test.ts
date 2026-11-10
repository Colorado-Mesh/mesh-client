/**
 * KNOWN-GOOD WORKING STATE — MeshCore 0-hop repeater admin (Ping / Status / Neighbors / Telemetry)
 *
 * Updated 2026-11 for receipt-derived timeouts, soft ping settle, and flood escalation.
 * DO NOT change the underlying behavior or these assertions unless the user explicitly
 * requests it. AI assistants must treat failures here as regressions, not invitations
 * to reintroduce multi-minute settle throws or flat est+120s reply waits.
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
  MESHCORE_REPEATER_ADMIN_RF_IDLE_MS,
  MESHCORE_REPEATER_PING_SETTLE_SOFT_MS,
  MESHCORE_REPEATER_REPLY_CAP_MS,
  MESHCORE_REPEATER_REPLY_FLOOR_MS,
  MESHCORE_REPEATER_REPLY_GRACE_MS,
  MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS,
  meshcoreRepeaterReplyWaitMs,
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
const ESCALATION_SOURCE = readFileSync(
  join(__dirname, 'meshcoreRepeaterRouteEscalation.ts'),
  'utf-8',
);

describe(`meshcore 0-hop repeater working state (${AI_GUARD})`, () => {
  it('uses receipt-derived reply cap (60s) for status, telemetry, and neighbors', () => {
    expect(MESHCORE_STATUS_TIMEOUT_MS).toBe(MESHCORE_REPEATER_REPLY_CAP_MS);
    expect(MESHCORE_TELEMETRY_TIMEOUT_MS).toBe(MESHCORE_REPEATER_REPLY_CAP_MS);
    expect(MESHCORE_NEIGHBORS_TIMEOUT_MS).toBe(MESHCORE_REPEATER_REPLY_CAP_MS);
    expect(MESHCORE_STATUS_TIMEOUT_MS).toBe(60_000);
    expect(meshcoreRepeaterRpcTimeoutMs(0)).toBe(30_000);
  });

  it('reply wait clamps est+grace into [floor, cap]', () => {
    expect(MESHCORE_REPEATER_REPLY_GRACE_MS).toBe(5_000);
    expect(MESHCORE_REPEATER_REPLY_FLOOR_MS).toBe(15_000);
    expect(MESHCORE_REPEATER_REPLY_CAP_MS).toBe(60_000);
    expect(meshcoreRepeaterReplyWaitMs({ estTimeoutMs: 4_000, hopsAway: 0 })).toBe(15_000);
    expect(meshcoreRepeaterReplyWaitMs({ estTimeoutMs: 20_000, hopsAway: 3 })).toBe(25_000);
    expect(meshcoreRepeaterReplyWaitMs({ estTimeoutMs: 0, hopsAway: 0 })).toBe(30_000);
    expect(meshcoreRepeaterReplyWaitMs({ estTimeoutMs: 0, hopsAway: 13 })).toBe(60_000);
  });

  it('soft ping settle is 10s and never throws after budget', () => {
    expect(MESHCORE_REPEATER_PING_SETTLE_SOFT_MS).toBe(10_000);
    expect(MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS).toBe(180_000);
    expect(TRACE_IDLE_SOURCE).toContain('proceededBusy');
    expect(TRACE_IDLE_SOURCE).toContain('MESHCORE_REPEATER_PING_SETTLE_SOFT_MS');
    expect(TRACE_IDLE_SOURCE).not.toMatch(
      /awaitMeshcoreRepeaterPingSettleForNode[\s\S]{0,400}throw new Error\('timeout waiting for ping'\)/,
    );
  });

  it('admin RF idle defaults to 15s soft proceed', () => {
    expect(MESHCORE_REPEATER_ADMIN_RF_IDLE_MS).toBe(15_000);
    expect(TRACE_IDLE_SOURCE).toContain('MESHCORE_REPEATER_ADMIN_RF_IDLE_MS');
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
    expect(PREFIX_PUSH_SOURCE).toContain('meshcoreRepeaterReplyWaitMs');
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

  it('runtime soft-settles then may flood-escalate status, telemetry, and neighbors', () => {
    const statusBody = extractUseCallbackBody(RUNTIME_SOURCE, 'requestRepeaterStatus');
    const telemetryBody = extractUseCallbackBody(RUNTIME_SOURCE, 'requestTelemetry');
    const neighborsBody = extractUseCallbackBody(RUNTIME_SOURCE, 'requestNeighbors');
    for (const body of [statusBody, telemetryBody, neighborsBody]) {
      expect(body).toContain('awaitMeshcoreRepeaterPingSettleForNode');
      expect(body).toContain('MESHCORE_REPEATER_PING_SETTLE_SOFT_MS');
      expect(body).toContain('hopsAway');
    }
    expect(telemetryBody).toContain('withMeshcoreRepeaterRouteEscalation');
    // Status and Neighbors wrap the same escalation and add one login after a timeout
    // (2026-11-10, user request): the first attempt stays login-free, the retry logs in when
    // a password exists.
    for (const body of [statusBody, neighborsBody]) {
      expect(body).toContain('withMeshcoreRepeaterLoginFallback');
      expect(body).not.toContain('withMeshcoreRepeaterRouteEscalation');
    }
    expect(ESCALATION_SOURCE).toMatch(
      /withMeshcoreRepeaterLoginFallback[\s\S]+return await withMeshcoreRepeaterRouteEscalation/,
    );
    expect(ESCALATION_SOURCE).toContain('resetContactPath');
    expect(ESCALATION_SOURCE).toContain('isMeshcoreRepeaterTimeoutError');
  });

  it('serializes admin RPCs per repeater node via runMeshcoreRepeaterRpcOnce', () => {
    expect(IN_FLIGHT_SOURCE).toContain('adminQueueTailByNode');
    expect(IN_FLIGHT_SOURCE).toContain("if (kind === 'trace')");
    const statusBody = extractUseCallbackBody(RUNTIME_SOURCE, 'requestRepeaterStatus');
    const neighborsBody = extractUseCallbackBody(RUNTIME_SOURCE, 'requestNeighbors');
    expect(statusBody).toContain("runMeshcoreRepeaterRpcOnce('status'");
    expect(neighborsBody).toContain('runMeshcoreRepeaterRpcOnce');
    expect(neighborsBody).toContain("'neighbors'");
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

  it('status and telemetry throw when disconnected (toast path), same as neighbors', () => {
    // Early resolveMeshcoreConn() null must throw — bare return skips RepeatersPanel toast.
    const statusBody = extractUseCallbackBody(RUNTIME_SOURCE, 'requestRepeaterStatus');
    const telemetryBody = extractUseCallbackBody(RUNTIME_SOURCE, 'requestTelemetry');
    const neighborsBody = extractUseCallbackBody(RUNTIME_SOURCE, 'requestNeighbors');
    for (const body of [statusBody, telemetryBody, neighborsBody]) {
      expect(body).toMatch(
        /if \(!resolveMeshcoreConn\(\)\) \{[\s\S]*?throw new Error\(MESHCORE_ERR_NOT_CONNECTED\);/,
      );
      expect(body).not.toMatch(
        /if \(!resolveMeshcoreConn\(\)\) \{[\s\S]*?next\.set\(nodeId, MESHCORE_ERR_NOT_CONNECTED\);[\s\S]*?return;\s*\}/,
      );
    }
  });

  it('neighbors fetch uses paged GetNeighbours count and optional offset', () => {
    const neighborsBody = extractUseCallbackBody(RUNTIME_SOURCE, 'requestNeighbors');
    expect(neighborsBody).toContain('MESHCORE_NEIGHBORS_PAGE_SIZE');
    expect(neighborsBody).toContain('opts?.offset');
    expect(neighborsBody).toContain('mergeMeshcoreNeighborPage');
    expect(neighborsBody).toContain('coalesceKey');
    expect(neighborsBody).not.toMatch(/count:\s*10\b/);
  });
});
