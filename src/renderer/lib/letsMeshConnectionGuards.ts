import i18n from './i18n';
import { deviceSigningWsPathForHost } from './letsMeshJwt';
import type { MQTTSettings } from './types';

const DEVICE_SIGNING_BROKER_PORT = 443;

/**
 * Hard validation before connecting with a device-signing MeshCore MQTT preset
 * (LetsMesh / MeshMapper / Colorado / Waev / Meshat.se / MeshCore.CA / EastMesh).
 * Requires WebSocket + TLS on 443 and the broker's expected `wsPath` (`/ws` vs `/mqtt`).
 */
export function validateLetsMeshPresetConnect(settings: MQTTSettings): string | null {
  if (!(settings.useWebSocket ?? false)) {
    return i18n.t('connectionPanel.letsMeshRequiresWebSocket');
  }
  if (settings.port !== DEVICE_SIGNING_BROKER_PORT) {
    return i18n.t('connectionPanel.letsMeshRequiresPort', { port: DEVICE_SIGNING_BROKER_PORT });
  }
  const expectedWsPath = deviceSigningWsPathForHost(settings.server);
  if (!expectedWsPath) {
    return i18n.t('connectionPanel.letsMeshKnownBrokersOnly');
  }
  if (!(settings.tlsEnabled ?? false)) {
    return i18n.t('connectionPanel.letsMeshRequiresTls');
  }
  if ((settings.wsPath?.trim() ?? '') !== expectedWsPath) {
    return i18n.t('connectionPanel.letsMeshRequiresWsPath', { wsPath: expectedWsPath });
  }
  return null;
}

const V1_USERNAME_HEX = /^v1_[0-9A-Fa-f]{64}$/;

/** When connecting manually (password set), username must be the meshcore v1_ form. */
export function validateLetsMeshManualCredentials(settings: MQTTSettings): string | null {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Persisted legacy settings may omit password at runtime.
  if (!settings.password?.trim()) return null;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Persisted legacy settings may omit username at runtime.
  if (!V1_USERNAME_HEX.test(settings.username?.trim() ?? '')) {
    return i18n.t('connectionPanel.letsMeshUsernameV1Hex');
  }
  return null;
}

/**
 * True if current fields diverge from what the active device-signing broker needs.
 * Host-aware: the expected `wsPath` follows the configured broker (`/ws` vs `/mqtt`), so a
 * mismatched path or host surfaces the deviation banner. LetsMesh region tuning may use a 60s
 * keepalive, so both 30 and 60 are accepted.
 */
export function letsMeshPresetConfigurationDeviation(settings: MQTTSettings): boolean {
  if (!(settings.useWebSocket ?? false)) return true;
  if (settings.port !== DEVICE_SIGNING_BROKER_PORT) return true;
  if (!(settings.tlsEnabled ?? false)) return true;
  const expectedWsPath = deviceSigningWsPathForHost(settings.server);
  if (!expectedWsPath) return true;
  if ((settings.wsPath?.trim() ?? '') !== expectedWsPath) return true;
  const keepalive = settings.keepalive ?? 30;
  if (keepalive !== 30 && keepalive !== 60) return true;
  return false;
}
