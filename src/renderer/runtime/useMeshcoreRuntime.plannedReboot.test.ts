import { describe, expect, it } from 'vitest';

import { extractUseCallbackBody, loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const RUNTIME_SOURCE = loadRuntimeSource('useMeshcoreRuntime.ts');

describe('useMeshcoreRuntime planned companion reboot (contract)', () => {
  it('floors the first reconnect delay only while a planned reboot is active', () => {
    expect(RUNTIME_SOURCE).toMatch(
      /firstAttemptMinDelayMs: \(\) =>\s*meshcorePlannedRebootRef\.current \? MESHCORE_PLANNED_REBOOT_RECONNECT_DELAY_MS : null/,
    );
  });

  it('shows reconnecting without connectionLoss during a planned reboot', () => {
    expect(RUNTIME_SOURCE).toMatch(
      /setReconnectingUi: \(attempt\) => \{\s*const plannedReboot = meshcorePlannedRebootRef\.current;[\s\S]*?connectionLoss: !plannedReboot,\s*plannedReboot,/,
    );
  });

  it('clears the planned-reboot flag on success, exhaustion, give-up and manual disconnect', () => {
    expect(RUNTIME_SOURCE).toMatch(
      /markSuccess\(\);[\s\S]{0,200}meshcorePlannedRebootRef\.current = false;[\s\S]{0,200}plannedReboot: false,/,
    );
    expect(RUNTIME_SOURCE).toMatch(
      /onExhausted: async \(params\) => \{\s*meshcorePlannedRebootRef\.current = false;/,
    );
    expect(RUNTIME_SOURCE).toMatch(
      /setDisconnectedUi: \(\) => \{\s*meshcorePlannedRebootRef\.current = false;/,
    );
    const disconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'disconnect');
    expect(disconnectBody).toContain('meshcorePlannedRebootRef.current = false;');
  });

  it('wires companion CLI reboot into the connection-lost reconnect owner', () => {
    expect(RUNTIME_SOURCE).toMatch(
      /useMeshcoreCompanionCli\(\{[\s\S]*?plannedRebootRef: meshcorePlannedRebootRef,\s*connectionLostRef: handleMeshcoreConnectionLostRef,/,
    );
  });

  it('mirrors plannedReboot into the connection store', () => {
    expect(RUNTIME_SOURCE).toMatch(
      /setConnection\(identityId, \{[\s\S]*?plannedReboot: state\.plannedReboot,/,
    );
  });
});
