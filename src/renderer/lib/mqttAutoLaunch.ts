import { MESHCORE_MQTT_CHAT_CONNECTION_ID } from '@/shared/meshcoreMqttConnections';

import { useMeshcoreMqttFeedStatusStore } from '../stores/meshcoreMqttFeedStatusStore';
import { meshcoreMqttNeedsColoradoRegionAck } from './connectionPanelStorageMigrations';
import { loadHiddenProtocols } from './enabledProtocols';
import { errLikeToLogString } from './errLikeToLogString';
import { meshcoreIdentityHasPrivateKey } from './letsMeshJwt';
import { readMeshcomMqttSettingsFromStorage } from './meshcomMqttSettingsStorage';
import { hasEnabledMeshcoreMqttFeed } from './meshcoreMqttFeedFlags';
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
  // Enabled analyzer feeds are independent of the chat broker's auto-launch toggle.
  if (hasEnabledMeshcoreMqttFeed()) return true;
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

  if (prot !== 'meshcore') {
    const settings =
      prot === 'meshcom'
        ? readMeshcomMqttSettingsFromStorage()
        : readMeshtasticMqttSettingsFromStorage();
    if (!settings.autoLaunch) return;
    const base =
      prot === 'meshtastic' ? { ...MESHTASTIC_OFFICIAL_PRESET_DEFAULTS, ...settings } : settings;
    const connectSettings: MQTTSettings = {
      ...base,
      mqttTransportProtocol: prot === 'meshcom' ? 'meshcom' : 'meshtastic',
    };
    await window.electronAPI.mqtt.connect(connectSettings);
    return;
  }

  // MeshCore: chat honors autoLaunch + its gates; enabled feeds start independently so a chat
  // prep/connect failure never blocks analyzer publishing. These modules stay out of the App
  // entry chunk (loaded only when MeshCore actually auto-launches).
  const settings = readMeshcoreMqttSettingsFromStorage();
  const [
    { connectEnabledMeshcoreMqttFeeds, prepareMeshcoreMqttConnect },
    { loadMeshcoreMqttFeeds },
  ] = await Promise.all([import('./meshcoreMqttConnect'), import('./meshcoreMqttFeeds')]);
  const feeds = loadMeshcoreMqttFeeds();
  const startFeeds = async (): Promise<void> => {
    const statuses = useMeshcoreMqttFeedStatusStore.getState().statuses;
    // Do not replace live sessions during startup; error/disconnected feeds still get a try.
    const pendingFeeds = feeds.filter(
      (feed) =>
        feed.enabled && statuses[feed.id] !== 'connected' && statuses[feed.id] !== 'connecting',
    );
    const { failures } = await connectEnabledMeshcoreMqttFeeds(pendingFeeds);
    if (failures.length > 0) {
      console.warn(`mcL0980 [App] ${failures.length} MeshCore MQTT feed(s) failed to auto-launch`);
    }
  };

  const chatStatus =
    useMeshcoreMqttFeedStatusStore.getState().statuses[MESHCORE_MQTT_CHAT_CONNECTION_ID];
  const chatAlreadyActive = chatStatus === 'connected' || chatStatus === 'connecting';
  if (!settings.autoLaunch || chatAlreadyActive) {
    await startFeeds();
    return;
  }

  if (meshcoreMqttNeedsColoradoRegionAck()) {
    console.warn(
      'mcL0977 [App] MQTT auto-launch deferred: Colorado Mesh region confirmation pending',
    );
    await startFeeds();
    return;
  }

  const connectSettings: MQTTSettings = { ...settings, mqttTransportProtocol: 'meshcore' };
  try {
    const prepared = await prepareMeshcoreMqttConnect({
      preset: readStoredMeshcoreMqttPreset(),
      settings: connectSettings,
    });
    if (!prepared.ok) {
      console.warn('mcL0978 [App] MQTT auto-launch skipped: ' + prepared.failure.message);
    } else {
      await window.electronAPI.mqtt.connect(prepared.settings);
    }
  } catch (e) {
    console.warn('mcL0979 [App] MQTT auto-launch connect failed ' + errLikeToLogString(e));
  }
  await startFeeds();
}
