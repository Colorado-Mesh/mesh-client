import {
  COLORADO_MESH_HOST,
  EASTMESH_HOST,
  isLetsMeshSettings,
  LETSMESH_HOST_EU,
  LETSMESH_HOST_US,
  MESHATSE_HOST,
  MESHCORE_CA_HOST_BACKUP,
  MESHCORE_CA_HOST_PRIMARY,
  MESHMAPPER_HOST,
  WAEV_HOST,
} from './letsMeshJwt';
import type { MQTTSettings } from './types';

export type MeshcoreMqttPreset =
  | 'letsmesh'
  | 'coloradomesh'
  | 'meshmapper'
  | 'waev'
  | 'meshatse'
  | 'meshcoreca'
  | 'eastmesh'
  | 'ripple'
  | 'custom';

export const MESHCORE_MQTT_PRESET_STORAGE_KEY = 'mesh-client:mqttPreset:meshcore';

const KNOWN_MESHCORE_MQTT_PRESETS = new Set<MeshcoreMqttPreset>([
  'letsmesh',
  'coloradomesh',
  'meshmapper',
  'waev',
  'meshatse',
  'meshcoreca',
  'eastmesh',
  'ripple',
]);

/**
 * Presets that authenticate with a MeshCore device-signed JWT (WSS + TLS on 443).
 * These share the LetsMesh connect flow (identity hint, deviation warning, token minting).
 *
 * Single source of truth: also drives IATA topic scoping ({@link isIataScopedMeshcoreMqtt}) and the
 * startup settings reconcile, so those never drift from the connect/deviation flow.
 */
export const DEVICE_SIGNING_MESHCORE_PRESETS: ReadonlySet<MeshcoreMqttPreset> = new Set([
  'letsmesh',
  'coloradomesh',
  'meshmapper',
  'waev',
  'meshatse',
  'meshcoreca',
  'eastmesh',
]);

/** True when the preset uses MeshCore device-signed JWT auth (WSS/TLS/443). */
export function isDeviceSigningMeshcorePreset(
  preset: MeshcoreMqttPreset | null | undefined,
): boolean {
  return !!preset && DEVICE_SIGNING_MESHCORE_PRESETS.has(preset);
}

/**
 * True when a MeshCore MQTT connection should use the device-signing JWT flow: either a named
 * device-signing preset is selected, or the configured server is a device-signing broker host.
 * The host branch keeps Custom (or hand-tuned) settings pointed at a known JWT broker consistent
 * between the manual Connect button and startup auto-launch.
 */
export function usesMeshcoreDeviceSigningMqtt(
  preset: MeshcoreMqttPreset | null | undefined,
  settings: Pick<MQTTSettings, 'server'>,
): boolean {
  return isDeviceSigningMeshcorePreset(preset) || isLetsMeshSettings(settings.server);
}

export function readStoredMeshcoreMqttPreset(): MeshcoreMqttPreset {
  const saved = localStorage.getItem(MESHCORE_MQTT_PRESET_STORAGE_KEY);
  // No key yet → new install defaults to LetsMesh (settings seeded by migrations).
  if (saved === null) return 'letsmesh';
  if (KNOWN_MESHCORE_MQTT_PRESETS.has(saved as MeshcoreMqttPreset)) {
    return saved as MeshcoreMqttPreset;
  }
  return 'custom';
}

/**
 * Common field block for a device-signing broker (WSS + TLS on 443, JWT auth).
 * Defaults the topic prefix to `meshcore/test`; callers override it per preset (e.g. Colorado DEN).
 */
function deviceSigningWssFields(server: string, wsPath: '/ws' | '/mqtt'): Partial<MQTTSettings> {
  return {
    server,
    port: 443,
    topicPrefix: 'meshcore/test',
    useWebSocket: true,
    tlsEnabled: true,
    wsPath,
    keepalive: 30,
    password: '',
  };
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
      return deviceSigningWssFields(server, '/ws');
    }
    case 'coloradomesh':
      return { ...deviceSigningWssFields(COLORADO_MESH_HOST, '/ws'), topicPrefix: 'meshcore/DEN' };
    case 'meshmapper':
      return deviceSigningWssFields(MESHMAPPER_HOST, '/ws');
    case 'waev':
      return deviceSigningWssFields(WAEV_HOST, '/mqtt');
    case 'meshatse':
      return deviceSigningWssFields(MESHATSE_HOST, '/mqtt');
    case 'meshcoreca': {
      const server =
        prev.server === MESHCORE_CA_HOST_BACKUP || prev.server === MESHCORE_CA_HOST_PRIMARY
          ? prev.server
          : MESHCORE_CA_HOST_PRIMARY;
      return deviceSigningWssFields(server, '/mqtt');
    }
    case 'eastmesh':
      return deviceSigningWssFields(EASTMESH_HOST, '/mqtt');
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
