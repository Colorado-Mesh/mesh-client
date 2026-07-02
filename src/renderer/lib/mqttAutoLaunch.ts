import { errLikeToLogString } from './errLikeToLogString';
import {
  validateLetsMeshManualCredentials,
  validateLetsMeshPresetConnect,
} from './letsMeshConnectionGuards';
import {
  generateLetsMeshAuthToken,
  isLetsMeshSettings,
  letsMeshMqttUsernameFromIdentity,
  meshcoreIdentityHasPrivateKey,
  readMeshcoreIdentityAsync,
} from './letsMeshJwt';
import { readMeshcoreMqttSettingsFromStorage } from './meshcoreMqttSettingsStorage';
import { readMeshtasticMqttSettingsFromStorage } from './meshtasticMqttSettingsStorage';
import { MESHTASTIC_OFFICIAL_PRESET_DEFAULTS } from './meshtasticMqttTlsMigration';
import type { MeshProtocol, MQTTSettings } from './types';

/**
 * JWT/device-signing MeshCore brokers need the radio-exported private key before connect.
 * Defer startup auto-launch until RF init persists identity (initConn triggers retry).
 */
export function shouldAutoLaunchMeshcoreMqttAtStartup(): boolean {
  const settings = readMeshcoreMqttSettingsFromStorage();
  if (!settings.autoLaunch) return false;
  if (isLetsMeshSettings(settings.server)) {
    return meshcoreIdentityHasPrivateKey();
  }
  return Boolean(settings.password?.trim());
}

/** Connect MQTT for `prot` when `autoLaunch` is enabled in persisted settings. */
export async function tryAutoLaunchMqtt(prot: MeshProtocol): Promise<void> {
  if (prot === 'reticulum') return;

  const settings =
    prot === 'meshcore'
      ? readMeshcoreMqttSettingsFromStorage()
      : readMeshtasticMqttSettingsFromStorage();
  if (!settings.autoLaunch) return;

  const base =
    prot === 'meshtastic' ? { ...MESHTASTIC_OFFICIAL_PRESET_DEFAULTS, ...settings } : settings;
  const connectSettings: MQTTSettings = {
    ...base,
    mqttTransportProtocol: prot === 'meshcore' ? 'meshcore' : 'meshtastic',
  };

  if (prot === 'meshcore' && isLetsMeshSettings(connectSettings.server)) {
    const presetErr = validateLetsMeshPresetConnect(connectSettings);
    if (presetErr) {
      console.warn('[App] MQTT auto-launch skipped: ' + errLikeToLogString(presetErr));
      return;
    }
    const identity = await readMeshcoreIdentityAsync();
    const hasFull = !!(identity?.private_key && identity?.public_key);
    if (hasFull) {
      try {
        const u = letsMeshMqttUsernameFromIdentity(identity);
        if (u) connectSettings.username = u;
        const { token, expiresAt } = await generateLetsMeshAuthToken(
          identity,
          connectSettings.server,
        );
        connectSettings.password = token;
        connectSettings.tokenExpiresAt = expiresAt;
      } catch (e) {
        console.warn(
          '[App] LetsMesh auth token auto-launch generation failed ' + errLikeToLogString(e),
        );
        return;
      }
    } else {
      if (!connectSettings.password?.trim()) {
        console.warn(
          '[App] MQTT auto-launch skipped: LetsMesh needs imported identity or password',
        );
        return;
      }
      const manualErr = validateLetsMeshManualCredentials(connectSettings);
      if (manualErr) {
        console.warn('[App] MQTT auto-launch skipped: ' + errLikeToLogString(manualErr));
        return;
      }
    }
  }

  await window.electronAPI.mqtt.connect(connectSettings);
}
