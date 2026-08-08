/**
 * Shared LoRa reconnect parity: MeshCore and Meshtastic must use createRfReconnectController
 * + runLoraRfReconnectAttempt so connection-lost never double-schedules while a cycle is
 * active (n7eal TCP / #792–#796 / #807).
 */
import { describe, expect, it } from 'vitest';

import {
  extractUseCallbackBody,
  loadRendererLibSource,
  loadRuntimeSource,
} from '../lib/sourceContractTestHelpers';

const MESHCORE = loadRuntimeSource('useMeshcoreRuntime.ts');
const MESHTASTIC = loadRuntimeSource('useMeshtasticRuntime.ts');
const ATTEMPT_RUNNER = loadRendererLibSource('loraRfReconnectAttempt.ts');

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
      expect(source).toContain('runLoraRfReconnectAttempt');

      const lostBody = extractUseCallbackBody(source, lostName);
      expect(lostBody).toContain('onLinkLost()');
      expect(lostBody).toContain('!linkLost.shouldStartOwner');
      // Must not fall through to schedule after await when shouldStartOwner is false.
      expect(lostBody).toMatch(
        /if \(!linkLost\.shouldStartOwner\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?schedule/,
      );

      const reconnectBody = extractUseCallbackBody(source, attemptName);
      expect(reconnectBody).toContain('runLoraRfReconnectAttempt');
      expect(reconnectBody).toContain('scheduleAttempt:');
      expect(reconnectBody).toContain(scheduleRef);
      // Shared finally flush must schedule via scheduleAttempt — never re-enter lost-handler.
      expect(ATTEMPT_RUNNER).toContain('endAttempt');
      expect(ATTEMPT_RUNNER).toContain('scheduleAttempt()');
      expect(ATTEMPT_RUNNER).not.toContain(lostRef);
    },
  );

  it('shared attempt runner owns budget + deferred finally flush for both protocols', () => {
    expect(ATTEMPT_RUNNER).toContain('raceWithDeadline');
    expect(ATTEMPT_RUNNER).toContain('NOBLE_BLE_RECONNECT_ATTEMPT_BUDGET_MS');
    expect(ATTEMPT_RUNNER).toContain('delayUnlessSuspended');
    expect(ATTEMPT_RUNNER).toContain('createBleReconnectTransportCleanup');
    expect(ATTEMPT_RUNNER).toMatch(
      /deferredReconnect\.get\(\) \|\| settled\.shouldSchedule[\s\S]*?scheduleAttempt\(\)/,
    );
  });

  it('MeshCore latches session after self-info; UI configured after contacts dump on all RF transports', () => {
    expect(MESHCORE).toContain('const configureBeforeContactsDump = true');
    expect(MESHCORE).toContain('meshcoreTcpContactsDumpInFlightRef');
    expect(MESHCORE).toContain('TCP closed during post-configure contacts dump — keep configured');
    expect(MESHCORE).toContain('preserving dbCache hydration');
    expect(MESHCORE).toContain('promoteConfiguredAfterContactsDump');
    expect(MESHCORE).toMatch(
      /meshcoreDeviceConfiguredRef\.current = true[\s\S]*?getContacts[\s\S]*?promoteConfiguredAfterContactsDump/,
    );
  });

  it('MeshCore TCP device_status disconnect does not double-call connection-lost', () => {
    // Runtime owns meshcore.tcp.onDisconnected; side effects must skip TCP.
    expect(MESHCORE).toContain('window.electronAPI.meshcore.tcp.onDisconnected');
  });
});
