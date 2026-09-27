import { markMqttUserDisconnect } from './mqttDisconnectIntent';

/**
 * Quit from the renderer. MQTT goes first so its drop reads as user-initiated; main owns the rest
 * of the teardown on quit (BLE disconnectAll, TCP destroy, quit-fast sidecar stop), so a graceful
 * stack stop here would only delay exit.
 */
export async function quitMeshClient(disconnectMqtt: boolean): Promise<void> {
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
