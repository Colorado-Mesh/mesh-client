import { isLetsMeshSettings } from './letsMeshJwt';
import type { MQTTSettings } from './types';

/** Hard validation before connecting with the LetsMesh preset (public US/EU brokers only). */
export function validateLetsMeshPresetConnect(settings: MQTTSettings): string | null {
  if (!(settings.useWebSocket ?? false)) {
    return 'LetsMesh requires WebSocket transport on port 443.';
  }
  if (settings.port !== 443) {
    return 'LetsMesh requires port 443.';
  }
  if (!isLetsMeshSettings(settings.server)) {
    return 'LetsMesh / MeshMapper preset only supports known device-signing brokers. Use Custom for other brokers.';
  }
  return null;
}

const V1_USERNAME_HEX = /^v1_[0-9A-Fa-f]{64}$/;

/** When connecting manually (password set), username must be the meshcore v1_ form. */
export function validateLetsMeshManualCredentials(settings: MQTTSettings): string | null {
  if (!settings.password?.trim()) return null;
  if (!V1_USERNAME_HEX.test((settings.username ?? '').trim())) {
    return 'Username must be v1_ followed by 64 hex characters (public key).';
  }
  return null;
}

/** True if current fields diverge from what the public LetsMesh brokers need. */
export function letsMeshPresetConfigurationDeviation(settings: MQTTSettings): boolean {
  if (!(settings.useWebSocket ?? false)) return true;
  if (settings.port !== 443) return true;
  if (!isLetsMeshSettings(settings.server)) return true;
  if ((settings.keepalive ?? 30) !== 30) return true;
  return false;
}
