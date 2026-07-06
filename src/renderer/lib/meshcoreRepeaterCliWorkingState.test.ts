/**
 * Source-contract tests for repeater CLI admin pipeline (queue split, idle, RESP_SENT).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractUseCallbackBody } from './sourceContractTestHelpers';

const RUNTIME_SOURCE = readFileSync(join(__dirname, '../runtime/useMeshcoreRuntime.ts'), 'utf-8');
const IN_FLIGHT_SOURCE = readFileSync(join(__dirname, 'meshcoreRepeaterRpcInFlight.ts'), 'utf-8');

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
});
