/**
 * Shared LoRa reconnect parity: MeshCore and Meshtastic must flush deferred reconnect via a
 * coalesced attempt scheduler — not nested handleConnectionLost (n7eal TCP dual backoff / #792).
 */
import { describe, expect, it } from 'vitest';

import { extractUseCallbackBody, loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const MESHCORE = loadRuntimeSource('useMeshcoreRuntime.ts');
const MESHTASTIC = loadRuntimeSource('useMeshtasticRuntime.ts');

describe('LoRa RF reconnect parity (MeshCore ↔ Meshtastic)', () => {
  it.each([
    {
      label: 'MeshCore',
      source: MESHCORE,
      attemptName: 'attemptMeshcoreReconnect',
      scheduleRef: 'scheduleMeshcoreReconnectAttemptRef.current()',
      lostRef: 'handleMeshcoreConnectionLostRef.current()',
      deferredRef: 'meshcoreDeferredReconnectRef.current',
    },
    {
      label: 'Meshtastic',
      source: MESHTASTIC,
      attemptName: 'attemptReconnect',
      scheduleRef: 'scheduleMeshtasticReconnectAttemptRef.current()',
      lostRef: 'handleConnectionLostRef.current()',
      deferredRef: 'meshtasticDeferredReconnectRef.current',
    },
  ] as const)(
    '$label reconnect finally flushes deferred via schedule, not nested connection-lost',
    ({ source, attemptName, scheduleRef, lostRef, deferredRef }) => {
      const reconnectBody = extractUseCallbackBody(source, attemptName);
      const finallyBody = reconnectBody.slice(reconnectBody.indexOf('finally {'));
      expect(finallyBody).toContain(deferredRef);
      expect(finallyBody).toContain(scheduleRef);
      expect(finallyBody).not.toContain(lostRef);
    },
  );

  it('MeshCore defers reconnect during backoff instead of starting a parallel attempt', () => {
    const lostBody = extractUseCallbackBody(MESHCORE, 'handleMeshcoreConnectionLost');
    expect(lostBody).toContain('deferForBackoff');
    expect(lostBody).toMatch(
      /deferForBackoff[\s\S]*?Connection lost during reconnect backoff — defer until delay settles/,
    );
    expect(lostBody).toMatch(
      /if \(deferForBackoff\) \{[\s\S]*?return;[\s\S]*?scheduleMeshcoreReconnectAttemptRef/,
    );
  });

  it('Meshtastic defers reconnect during backoff instead of starting a parallel attempt', () => {
    const lostBody = extractUseCallbackBody(MESHTASTIC, 'handleConnectionLost');
    expect(lostBody).toContain('deferForBackoff');
    expect(lostBody).toMatch(
      /deferForBackoff[\s\S]*?Connection lost during reconnect backoff — defer until delay settles/,
    );
    expect(lostBody).toMatch(
      /if \(deferForBackoff\) \{[\s\S]*?return;[\s\S]*?scheduleMeshtasticReconnectAttemptRef/,
    );
  });

  it('MeshCore TCP defers status=configured until after contacts+channels', () => {
    expect(MESHCORE).toContain("const deferConfiguredUntilRadioInit = transportType === 'tcp'");
    expect(MESHCORE).toMatch(
      /deferConfiguredUntilRadioInit \? 'connected' : 'configured'[\s\S]*?if \(!deferConfiguredUntilRadioInit\) \{[\s\S]*?meshcoreDeviceConfiguredRef\.current = true/,
    );
    expect(MESHCORE).toMatch(
      /if \(deferConfiguredUntilRadioInit\) \{[\s\S]*?status: 'configured'[\s\S]*?triggerRoomAutoLoginRef\.current\(\)/,
    );
  });
});
