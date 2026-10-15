import { describe, expect, it } from 'vitest';

import { extractUseCallbackBody, loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const RUNTIME_SOURCE = loadRuntimeSource('useMeshcoreRuntime.ts');

describe('useMeshcoreRuntime telemetry push (contract)', () => {
  it('decodes requested and pushed telemetry through one LPP path', () => {
    expect(extractUseCallbackBody(RUNTIME_SOURCE, 'requestTelemetry')).toContain(
      "applyMeshcoreTelemetryLpp(nodeId, raw.lppSensorData, 'rpc');",
    );
    expect(RUNTIME_SOURCE).toContain("applyMeshcoreTelemetryLpp(nodeId, lpp, 'push');");
    expect(extractUseCallbackBody(RUNTIME_SOURCE, 'applyMeshcoreTelemetryLpp')).toContain(
      'meshcoreTelemetryChannelsRef.current.set(',
    );
  });

  it('logs in to the sensor before a push request', () => {
    const body = extractUseCallbackBody(RUNTIME_SOURCE, 'sendMeshcoreSensorRequest');
    expect(body.indexOf('meshcoreTryRemoteServerLogin(')).toBeGreaterThan(-1);
    expect(body.indexOf('meshcoreTryRemoteServerLogin(')).toBeLessThan(
      body.indexOf('runMeshcoreRepeaterBinaryRequest('),
    );
  });

  it('forgets subscriptions on manual disconnect', () => {
    expect(extractUseCallbackBody(RUNTIME_SOURCE, 'disconnect')).toContain(
      'meshcoreTelemetryPushClearRef.current();',
    );
    expect(RUNTIME_SOURCE).toContain(
      'meshcoreTelemetryPushClearRef.current = telemetryPush.clearAll;',
    );
  });
});
