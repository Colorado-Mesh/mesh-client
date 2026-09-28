import { openMaydayUrgentCount, useIncidentStore } from '@/renderer/stores/incidentStore';
import { REGISTERED_MESH_PROTOCOLS } from '@/shared/meshProtocol';

import { markMqttUserDisconnect } from './mqttDisconnectIntent';
import { cancelProtocolRfAutoConnect } from './protocolRfAutoConnectGate';

/** What a quit would cut off, for the header button's confirmation. */
export interface QuitRisks {
  /** A radio or MQTT link is up on some protocol. */
  linkUp: boolean;
  openEmergencies: number;
  pendingEmergencyMessages: number;
}

/** Counts open MAYDAY / URGENT incidents and emergency outbox rows across every protocol. */
export async function gatherQuitRisks(linkUp: boolean): Promise<QuitRisks> {
  let pendingEmergencyMessages = 0;
  for (const protocol of REGISTERED_MESH_PROTOCOLS) {
    try {
      const rows = await window.electronAPI.chat.outbox.list(protocol);
      pendingEmergencyMessages += rows.filter((row) => row.priority === 'emergency').length;
    } catch (err) {
      console.warn(
        '[quitMeshClient] outbox.list before quit failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return {
    linkUp,
    openEmergencies: openMaydayUrgentCount(useIncidentStore.getState()),
    pendingEmergencyMessages,
  };
}

export function quitNeedsConfirm(risks: QuitRisks): boolean {
  return risks.linkUp || risks.openEmergencies > 0 || risks.pendingEmergencyMessages > 0;
}

/**
 * Stop auto-connect retries and a pending serial port chooser, as the Connection panel's cancel
 * does, so nothing starts a new connect while the app is closing.
 */
function cancelPendingConnects(): void {
  for (const protocol of REGISTERED_MESH_PROTOCOLS) cancelProtocolRfAutoConnect(protocol);
  try {
    window.electronAPI.cancelSerialSelection();
  } catch (err) {
    console.debug(
      '[quitMeshClient] cancelSerialSelection before quit failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Quit from the renderer. MQTT goes first so its drop reads as user-initiated; main owns the rest
 * of the teardown on quit (BLE disconnectAll, TCP destroy, quit-fast sidecar stop), so a graceful
 * stack stop here would only delay exit.
 */
export async function quitMeshClient(disconnectMqtt: boolean): Promise<void> {
  cancelPendingConnects();
  if (disconnectMqtt) {
    // A disconnect failure, sync or async, must not block quitApp.
    try {
      markMqttUserDisconnect();
      void window.electronAPI.mqtt.disconnect().catch((err: unknown) => {
        console.warn(
          '[quitMeshClient] mqtt.disconnect before quit failed:',
          err instanceof Error ? err.message : String(err),
        );
      });
    } catch (err) {
      console.warn(
        '[quitMeshClient] mqtt.disconnect before quit failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  try {
    await window.electronAPI.quitApp();
  } catch (err) {
    console.error(
      '[quitMeshClient] quitApp failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}
