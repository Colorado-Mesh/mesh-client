/**
 * Source-contract tests for repeater CLI admin pipeline (queue split, idle, RESP_SENT).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractUseCallbackBody } from './sourceContractTestHelpers';

const RUNTIME_SOURCE = readFileSync(join(__dirname, '../runtime/useMeshcoreRuntime.ts'), 'utf-8');
const IN_FLIGHT_SOURCE = readFileSync(join(__dirname, 'meshcoreRepeaterRpcInFlight.ts'), 'utf-8');
const REPEATER_CMD_SOURCE = readFileSync(join(__dirname, 'repeaterCommandService.ts'), 'utf-8');

describe('meshcore repeater CLI working state', () => {
  it('serializes CLI per repeater node via runMeshcoreRepeaterRpcOnce', () => {
    expect(IN_FLIGHT_SOURCE).toContain("'cli'");
    const cliBody = extractUseCallbackBody(RUNTIME_SOURCE, 'sendRepeaterCliCommand');
    expect(cliBody).toContain("runMeshcoreRepeaterRpcOnce('cli'");
  });

  it('awaits ping settle and login with companion queue before CLI send', () => {
    const cliBody = extractUseCallbackBody(RUNTIME_SOURCE, 'sendRepeaterCliCommand');
    expect(cliBody).toContain('awaitMeshcoreRepeaterPingSettleForNode');
    expect(cliBody).toContain('meshcoreTryRemoteServerLogin');
    expect(cliBody).toContain('repeaterRemoteRpcRef.current');
  });

  it('holds companion queue only until RESP_SENT; response wait is outside queue slot', () => {
    const cliBody = extractUseCallbackBody(RUNTIME_SOURCE, 'sendRepeaterCliCommand');
    expect(cliBody).toContain('waitForMeshcoreRadioSentAck');
    expect(cliBody).toContain('awaitMeshcoreRepeaterAdminRfIdle');
    const sendSlotStart = cliBody.indexOf('await repeaterRemoteRpcRef.current(async () => {');
    const sendSlotEnd = cliBody.indexOf('});', sendSlotStart);
    const responseWaitIdx = cliBody.indexOf('const response = await promise');
    expect(sendSlotStart).toBeGreaterThan(-1);
    expect(responseWaitIdx).toBeGreaterThan(sendSlotEnd);
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
});
