/**
 * Source-contract tests for repeater CLI admin pipeline (queue split, idle, RESP_SENT).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  extractIfBlockBody,
  extractUseCallbackBody,
  loadRuntimeSource,
} from './sourceContractTestHelpers';

const RUNTIME_SOURCE = loadRuntimeSource('useMeshcoreRuntime.ts');
const IN_FLIGHT_SOURCE = readFileSync(join(__dirname, 'meshcoreRepeaterRpcInFlight.ts'), 'utf-8');
const REPEATER_CMD_SOURCE = readFileSync(join(__dirname, 'repeaterCommandService.ts'), 'utf-8');

describe('meshcore repeater CLI working state', () => {
  it('serializes CLI per repeater node via runMeshcoreRepeaterRpcOnce', () => {
    expect(IN_FLIGHT_SOURCE).toContain("'cli'");
    const cliBody = extractUseCallbackBody(RUNTIME_SOURCE, 'sendRepeaterCliCommand');
    expect(cliBody).toMatch(/runMeshcoreRepeaterRpcOnce\(\s*'cli'/);
  });

  it('checks the captured session and caller lifetime before queued CLI transmission', () => {
    const cliBody = extractUseCallbackBody(RUNTIME_SOURCE, 'sendRepeaterCliCommand');
    expect(cliBody).toContain('connectionAtRequest !== connRef.current');
    expect(cliBody).toContain('identityAtRequest !== meshcoreIdentityIdRef.current');
    expect(cliBody).toContain('setupGenerationAtRequest !== meshcoreSetupGenerationRef.current');
    expect(cliBody).toContain('!opts.isCurrent()');
    const sendSlotStart = cliBody.indexOf('await repeaterRemoteRpcRef.current(async () => {');
    const sendIdx = cliBody.indexOf('await conn.sendTextMessage', sendSlotStart);
    expect(sendIdx).toBeGreaterThan(sendSlotStart);
    expect(cliBody.slice(sendSlotStart, sendIdx)).toContain('assertRequestCurrent();');
  });

  it('releases shared CLI holds only for the connection generation that acquired them', () => {
    const cliBody = extractUseCallbackBody(RUNTIME_SOURCE, 'sendRepeaterCliCommand');
    const cleanup = extractIfBlockBody(
      cliBody,
      '\n            identityAtRequest === meshcoreIdentityIdRef.current &&\n            setupGenerationAtRequest === meshcoreSetupGenerationRef.current\n          ',
    );
    expect(cleanup).toContain('endMeshcoreSilentBulkCliPreempt();');
    expect(cleanup).toContain('endMeshcoreCliReplyHold();');
  });

  it.each([
    ['handleMeshcoreConnectionLost', 'meshcoreRfReconnectRef.current.onLinkLost()'],
    ['prepareRfConnect', 'await connectionDriver.disconnect'],
  ])('clears the superseded CLI session in %s before reconnecting', (callback, boundary) => {
    const body = extractUseCallbackBody(RUNTIME_SOURCE, callback);
    const generationIdx = body.indexOf('meshcoreSetupGenerationRef.current += 1;');
    const boundaryIdx = body.indexOf(boundary);
    expect(generationIdx).toBeGreaterThan(-1);
    expect(boundaryIdx).toBeGreaterThan(generationIdx);
    for (const cleanup of [
      'resetMeshcoreWaitingMessagesDrainSchedule();',
      'resetMeshcoreRepeaterRpcInFlightOnDisconnect();',
      'setMeshcoreRepeaterRpcPending(new Map());',
      'repeaterCommandServiceRef.current?.clear();',
    ]) {
      const cleanupIdx = body.indexOf(cleanup);
      expect(cleanupIdx, cleanup).toBeGreaterThan(generationIdx);
      expect(cleanupIdx, cleanup).toBeLessThan(boundaryIdx);
    }
  });

  it('observes reply rejection before a queued send can be cancelled', () => {
    const cliBody = extractUseCallbackBody(RUNTIME_SOURCE, 'sendRepeaterCliCommand');
    const registerIdx = cliBody.indexOf('service.registerPendingCommand');
    const observerIdx = cliBody.indexOf('void promise.catch', registerIdx);
    const sendSlotIdx = cliBody.indexOf(
      'await repeaterRemoteRpcRef.current(async () => {',
      registerIdx,
    );
    expect(observerIdx).toBeGreaterThan(registerIdx);
    expect(observerIdx).toBeLessThan(sendSlotIdx);
  });

  it('resolves repeater pubkey via ensureNodePubKey like other admin RPCs', () => {
    const cliBody = extractUseCallbackBody(RUNTIME_SOURCE, 'sendRepeaterCliCommand');
    expect(cliBody).toContain('ensureNodePubKey');
    expect(cliBody).not.toMatch(/pubKeyMapRef\.current\.get\(nodeId\)/);
  });

  it('awaits ping settle and login with companion queue before CLI send', () => {
    const cliBody = extractUseCallbackBody(RUNTIME_SOURCE, 'sendRepeaterCliCommand');
    expect(cliBody).toContain('awaitMeshcoreRepeaterPingSettleForNode');
    expect(cliBody).toContain('MESHCORE_CLI_PREEMPT_TRACE_REASON');
    expect(cliBody).toContain('cancelAllPendingMeshcoreTracePaths');
    expect(cliBody).toContain('beginMeshcoreCliReplyHold');
    expect(cliBody).toContain('endMeshcoreCliReplyHold');
    expect(cliBody).toContain('preemptMeshcoreSilentBulkForCli');
    expect(cliBody).toContain('endMeshcoreSilentBulkCliPreempt');
    expect(cliBody).toContain('restartPendingTimeoutFromNow');
    expect(cliBody).toContain('force: true');
    expect(cliBody).toContain('incrementalOnly: true');
    expect(cliBody).toContain('responsePromise');
    expect(cliBody).toContain('meshcoreTryRemoteServerLogin');
    expect(cliBody).toContain('meshcoreRepeaterTryLoginWithPassword');
    expect(cliBody).toContain('meshcoreCancelRoomLogin');
    expect(cliBody).toContain('resolveRoomAdminPassword');
    expect(cliBody).toContain('repeaterRemoteRpcRef.current');
  });

  it('holds companion queue only until RESP_SENT; response wait is outside queue slot', () => {
    const cliBody = extractUseCallbackBody(RUNTIME_SOURCE, 'sendRepeaterCliCommand');
    expect(cliBody).toContain('waitForMeshcoreRadioSentAck');
    expect(cliBody).toContain('awaitMeshcoreRepeaterAdminRfIdle');
    const sendSlotStart = cliBody.indexOf('await repeaterRemoteRpcRef.current(async () => {');
    const sendSlotEnd = cliBody.indexOf('});', sendSlotStart);
    const responseWaitIdx = cliBody.indexOf('const response = await onceResult.responsePromise');
    expect(sendSlotStart).toBeGreaterThan(-1);
    expect(responseWaitIdx).toBeGreaterThan(sendSlotEnd);
  });

  it('waits for waiting-message drain idle before runMeshcoreRepeaterRpcOnce', () => {
    const cliBody = extractUseCallbackBody(RUNTIME_SOURCE, 'sendRepeaterCliCommand');
    // 0-hop skips the wait (drainWaitMs=0); multi-hop still awaits drain idle.
    expect(cliBody).toContain('awaitMeshcoreWaitingMessagesDrainIdle');
    expect(cliBody).toContain('drainWaitMs');
    const drainHelperIdx = cliBody.indexOf('awaitMeshcoreWaitingMessagesDrainIdle');
    const onceIdx = cliBody.search(/runMeshcoreRepeaterRpcOnce\(\s*'cli'/);
    expect(drainHelperIdx).toBeGreaterThan(-1);
    expect(onceIdx).toBeGreaterThan(drainHelperIdx);
    expect(cliBody).toContain('padRepeaterCliTimeoutForWaitingDrain');
    expect(cliBody).toContain('restartPendingTimeoutFromNow');
  });

  it('waits for CLI DM response after runMeshcoreRepeaterRpcOnce so waiting-message drain can run', () => {
    const cliBody = extractUseCallbackBody(RUNTIME_SOURCE, 'sendRepeaterCliCommand');
    expect(cliBody).toContain('responsePromise');
    const onceIdx = cliBody.search(/runMeshcoreRepeaterRpcOnce\(\s*'cli'/);
    const responseWaitIdx = cliBody.indexOf('const response = await onceResult.responsePromise');
    expect(onceIdx).toBeGreaterThan(-1);
    expect(responseWaitIdx).toBeGreaterThan(onceIdx);
  });

  it('rejects CLI commands longer than REPEATER_CLI_MAX_COMMAND_LENGTH before send', () => {
    expect(REPEATER_CMD_SOURCE).toContain('export const REPEATER_CLI_MAX_COMMAND_LENGTH = 512');
    const cliBody = extractUseCallbackBody(RUNTIME_SOURCE, 'sendRepeaterCliCommand');
    expect(cliBody).toContain('REPEATER_CLI_MAX_COMMAND_LENGTH');
    expect(cliBody).toContain('repeatersPanel.cliCommandTooLong');
  });

  it('requires confirmedDanger for dangerous CLI commands', () => {
    const cliBody = extractUseCallbackBody(RUNTIME_SOURCE, 'sendRepeaterCliCommand');
    expect(cliBody).toContain('isMeshcoreRepeaterCliDangerCommand');
    expect(cliBody).toContain('confirmedDanger');
    expect(cliBody).toContain('meshcore.errors.cliDangerNotConfirmed');
  });

  it('registers pending CLI with senderNodeId for response matching', () => {
    const cliBody = extractUseCallbackBody(RUNTIME_SOURCE, 'sendRepeaterCliCommand');
    expect(cliBody).toContain('senderNodeId: nodeId');
  });

  it('syncs companion time before repeater clock sync and reports actual CLI timeout on error', () => {
    const cliBody = extractUseCallbackBody(RUNTIME_SOURCE, 'sendRepeaterCliCommand');
    expect(cliBody).toContain("trimmed.toLowerCase() === 'clock sync'");
    expect(cliBody).toContain('syncDeviceTime');
    expect(cliBody).toContain('meshcoreRepeaterRpcErrorMessage(errMsg, cliTimeoutMs)');
  });
});
