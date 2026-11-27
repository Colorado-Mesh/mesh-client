import { meshcoreMqttNeedsColoradoRegionAck } from './connectionPanelStorageMigrations';
import { loadHiddenProtocols } from './enabledProtocols';
import { errLikeToLogString } from './errLikeToLogString';
import { meshcoreIdentityHasPrivateKey } from './letsMeshJwt';
import { readMeshcomMqttSettingsFromStorage } from './meshcomMqttSettingsStorage';
import { connectEnabledMeshcoreMqttFeeds, prepareMeshcoreMqttConnect } from './meshcoreMqttConnect';
import { loadMeshcoreMqttFeeds } from './meshcoreMqttFeeds';
import { readStoredMeshcoreMqttPreset, usesMeshcoreDeviceSigningMqtt } from './meshcoreMqttPresets';
import { readMeshcoreMqttSettingsFromStorage } from './meshcoreMqttSettingsStorage';
import { readMeshtasticMqttSettingsFromStorage } from './meshtasticMqttSettingsStorage';
import { MESHTASTIC_OFFICIAL_PRESET_DEFAULTS } from './meshtasticMqttTlsMigration';
import type { MeshProtocol, MQTTSettings } from './types';

/**
 * JWT/device-signing MeshCore brokers need the radio-exported private key before connect.
 * Defer startup auto-launch until RF init persists identity (initConn triggers retry).
 * Also defer while the Colorado Mesh region confirmation is unanswered.
 */
export function shouldAutoLaunchMeshcoreMqttAtStartup(): boolean {
  const settings = readMeshcoreMqttSettingsFromStorage();
  if (!settings.autoLaunch) return false;
  if (meshcoreMqttNeedsColoradoRegionAck()) return false;
  // Device-signing gate follows the shared predicate (named preset OR device-signing host), so a
  // Waev/EastMesh preset with a stale server still defers on the imported key rather than a password.
  const preset = readStoredMeshcoreMqttPreset();
  if (usesMeshcoreDeviceSigningMqtt(preset, settings)) {
    return meshcoreIdentityHasPrivateKey();
  }
  return Boolean(settings.password.trim());
}

/** Connect MQTT for `prot` when `autoLaunch` is enabled in persisted settings. */
export async function tryAutoLaunchMqtt(prot: MeshProtocol): Promise<void> {
  if (prot === 'reticulum') return;
  if (loadHiddenProtocols().includes(prot)) {
    console.debug(`[App] MQTT auto-launch skipped: ${prot} is disabled in App → Protocols`);
    return;
  }

  const settings =
    prot === 'meshcore'
      ? readMeshcoreMqttSettingsFromStorage()
      : prot === 'meshcom'
        ? readMeshcomMqttSettingsFromStorage()
        : readMeshtasticMqttSettingsFromStorage();
  if (!settings.autoLaunch) return;

  if (prot === 'meshcore' && meshcoreMqttNeedsColoradoRegionAck()) {
    console.warn(
      'mcL0977 [App] MQTT auto-launch deferred: Colorado Mesh region confirmation pending',
    );
    return;
  }

  const base =
    prot === 'meshtastic' ? { ...MESHTASTIC_OFFICIAL_PRESET_DEFAULTS, ...settings } : settings;
  const connectSettings: MQTTSettings = {
    ...base,
    mqttTransportProtocol:
      prot === 'meshcore' ? 'meshcore' : prot === 'meshcom' ? 'meshcom' : 'meshtastic',
  };

  if (prot !== 'meshcore') {
    await window.electronAPI.mqtt.connect(connectSettings);
    return;
  }

  // Chat broker first (it is the only bidirectional session), then enabled analyzer feeds.
  const prepared = await prepareMeshcoreMqttConnect({
    preset: readStoredMeshcoreMqttPreset(),
    settings: connectSettings,
  });
  if (!prepared.ok) {
    console.warn('mcL0978 [App] MQTT auto-launch skipped: ' + prepared.failure.message);
    return;
  }
  try {
    await window.electronAPI.mqtt.connect(prepared.settings);
  } catch (e) {
    console.warn('mcL0979 [App] MQTT auto-launch connect failed ' + errLikeToLogString(e));
    return;
  }
  const { failures } = await connectEnabledMeshcoreMqttFeeds(loadMeshcoreMqttFeeds());
  if (failures.length > 0) {
    console.warn(`mcL0980 [App] ${failures.length} MeshCore MQTT feed(s) failed to auto-launch`);
  }
}
