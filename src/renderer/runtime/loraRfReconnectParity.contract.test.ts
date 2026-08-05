/**
 * Shared LoRa reconnect parity: MeshCore and Meshtastic must use createRfReconnectController
 * so connection-lost never double-schedules while a cycle is active (n7eal TCP / #792–#796).
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
      controllerRef: 'meshcoreRfReconnectRef',
      attemptName: 'attemptMeshcoreReconnect',
      scheduleRef: 'scheduleMeshcoreReconnectAttemptRef.current()',
      lostRef: 'handleMeshcoreConnectionLostRef.current()',
      lostName: 'handleMeshcoreConnectionLost',
    },
    {
      label: 'Meshtastic',
      source: MESHTASTIC,
      controllerRef: 'meshtasticRfReconnectRef',
      attemptName: 'attemptReconnect',
      scheduleRef: 'scheduleMeshtasticReconnectAttemptRef.current()',
      lostRef: 'handleConnectionLostRef.current()',
      lostName: 'handleConnectionLost',
    },
  ] as const)(
    '$label uses createRfReconnectController and lost-handler never schedules when cycle active',
    ({ source, controllerRef, attemptName, scheduleRef, lostRef, lostName }) => {
      expect(source).toContain('createRfReconnectController');
      expect(source).toContain(controllerRef);
      expect(source).toContain('shouldStartOwner');

      const lostBody = extractUseCallbackBody(source, lostName);
      expect(lostBody).toContain('onLinkLost()');
      expect(lostBody).toContain('!linkLost.shouldStartOwner');
      // Must not fall through to schedule after await when shouldStartOwner is false.
      expect(lostBody).toMatch(
        /if \(!linkLost\.shouldStartOwner\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?schedule/,
      );

      const reconnectBody = extractUseCallbackBody(source, attemptName);
      const finallyBody = reconnectBody.slice(reconnectBody.indexOf('finally {'));
      expect(finallyBody).toContain(scheduleRef);
      expect(finallyBody).not.toContain(lostRef);
      expect(finallyBody).toContain('endAttempt');
    },
  );

  it('MeshCore TCP defers status=configured until after contacts+channels', () => {
    expect(MESHCORE).toContain("const deferConfiguredUntilRadioInit = transportType === 'tcp'");
    expect(MESHCORE).toMatch(
      /deferConfiguredUntilRadioInit \? 'connected' : 'configured'[\s\S]*?if \(!deferConfiguredUntilRadioInit\) \{[\s\S]*?meshcoreDeviceConfiguredRef\.current = true/,
    );
    expect(MESHCORE).toMatch(
      /if \(deferConfiguredUntilRadioInit\) \{[\s\S]*?status: 'configured'[\s\S]*?triggerRoomAutoLoginRef\.current\(\)/,
    );
  });

  it('MeshCore TCP device_status disconnect does not double-call connection-lost', () => {
    // Runtime owns meshcore.tcp.onDisconnected; side effects must skip TCP.
    expect(MESHCORE).toContain('window.electronAPI.meshcore.tcp.onDisconnected');
  });
});
