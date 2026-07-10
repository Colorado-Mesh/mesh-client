import {
  COLORADO_MESH_HOST,
  LETSMESH_HOST_EU,
  LETSMESH_HOST_US,
  MESHMAPPER_HOST,
} from './letsMeshJwt';
import type { MQTTSettings } from './types';

export type MeshcoreMqttPreset = 'letsmesh' | 'coloradomesh' | 'meshmapper' | 'ripple' | 'custom';

export const MESHCORE_MQTT_PRESET_STORAGE_KEY = 'mesh-client:mqttPreset:meshcore';

const KNOWN_MESHCORE_MQTT_PRESETS = new Set<MeshcoreMqttPreset>([
  'letsmesh',
  'coloradomesh',
  'meshmapper',
  'ripple',
]);

export function readStoredMeshcoreMqttPreset(): MeshcoreMqttPreset {
  const saved = localStorage.getItem(MESHCORE_MQTT_PRESET_STORAGE_KEY);
  if (saved && KNOWN_MESHCORE_MQTT_PRESETS.has(saved as MeshcoreMqttPreset)) {
    return saved as MeshcoreMqttPreset;
  }
  return 'custom';
}

/** Preset-owned MQTT fields (Connection tab preset buttons). */
export function meshcoreMqttPresetFields(
  preset: MeshcoreMqttPreset,
  prev: MQTTSettings,
): Partial<MQTTSettings> | null {
  switch (preset) {
    case 'letsmesh': {
      const server =
        prev.server === LETSMESH_HOST_EU || prev.server === LETSMESH_HOST_US
          ? prev.server
          : LETSMESH_HOST_US;
      return {
        server,
        port: 443,
        topicPrefix: 'meshcore/test',
        useWebSocket: true,
        tlsEnabled: true,
        wsPath: '/ws',
        keepalive: 30,
        password: '',
      };
    }
    case 'coloradomesh':
      return {
        server: COLORADO_MESH_HOST,
        port: 443,
        topicPrefix: 'meshcore/DEN',
        useWebSocket: true,
        tlsEnabled: true,
        wsPath: '/ws',
        keepalive: 30,
        password: '',
      };
    case 'meshmapper':
      return {
        server: MESHMAPPER_HOST,
        port: 443,
        topicPrefix: 'meshcore/test',
        useWebSocket: true,
        tlsEnabled: true,
        wsPath: '/ws',
        keepalive: 30,
        password: '',
      };
    case 'ripple':
      return {
        server: 'mqtt.ripplenetworks.com.au',
        port: 8883,
        username: 'nswmesh',
        password: 'nswmesh',
        topicPrefix: 'meshcore',
        tlsInsecure: true,
        useWebSocket: false,
      };
    default:
      return null;
  }
}

/** Apply preset defaults onto stored settings, preserving user-owned fields. */
export function applyMeshcoreMqttPreset(
  preset: MeshcoreMqttPreset,
  settings: MQTTSettings,
): MQTTSettings {
  const fields = meshcoreMqttPresetFields(preset, settings);
  if (!fields) return settings;
  return { ...settings, ...fields };
}
