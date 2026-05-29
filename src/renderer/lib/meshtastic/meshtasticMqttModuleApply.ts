import type { TFunction } from 'i18next';

const DEFAULT_MQTT_ADDRESS = 'mqtt.meshtastic.org';

function cfgBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function cfgStr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

/** Strip protobuf metadata before sending config back to the radio. */
export function stripMeshtasticProtobufMeta(cfg: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...cfg };
  delete rest.$typeName;
  return rest;
}

export interface MqttModuleUiValues {
  enabled: boolean;
  address: string;
  username: string;
  password: string;
  encryptionEnabled: boolean;
  jsonEnabled: boolean;
  tlsEnabled: boolean;
  root: string;
  mapReportingEnabled: boolean;
  proxyToClientEnabled: boolean;
}

/** Device network capability from Meshtastic DeviceMetadata (configure / getMetadata). */
export interface MeshtasticDeviceNetworkCapabilities {
  hasWifi?: boolean;
  hasEthernet?: boolean;
}

/** True when firmware requires mqtt.proxy_to_client_enabled (no native IP stack). */
export function meshtasticDeviceRequiresMqttProxyToClient(
  caps: MeshtasticDeviceNetworkCapabilities | undefined,
): boolean {
  if (!caps) return false;
  return caps.hasWifi !== true && caps.hasEthernet !== true;
}

/** Merge device MQTT module config with UI edits so hidden fields are not cleared on apply. */
export function buildMeshtasticMqttModuleApplyValue(
  deviceMqtt: Record<string, unknown>,
  ui: MqttModuleUiValues,
  deviceNetwork?: MeshtasticDeviceNetworkCapabilities,
): Record<string, unknown> {
  const base = stripMeshtasticProtobufMeta(deviceMqtt);
  const requiresProxy = ui.enabled && meshtasticDeviceRequiresMqttProxyToClient(deviceNetwork);
  const proxyToClientEnabled = requiresProxy ? true : ui.proxyToClientEnabled;
  const merged: Record<string, unknown> = {
    ...base,
    enabled: ui.enabled,
    address: ui.address.trim(),
    username: ui.username,
    password: ui.password,
    encryptionEnabled: ui.encryptionEnabled,
    jsonEnabled: ui.jsonEnabled,
    tlsEnabled: ui.tlsEnabled,
    root: ui.root,
    mapReportingEnabled: ui.mapReportingEnabled,
    proxyToClientEnabled,
  };

  if (merged.mapReportingEnabled === true && merged.mapReportSettings == null) {
    merged.mapReportSettings = {
      publishIntervalSecs: 0,
      positionPrecision: 10,
    };
  }

  return merged;
}

export function isDefaultMeshtasticMqttServer(address: string): boolean {
  const host = address.trim().split(':')[0] ?? '';
  return host.length === 0 || host === DEFAULT_MQTT_ADDRESS;
}

/** Returns port when address includes `:port`, otherwise undefined. */
export function parseMeshtasticMqttAddressPort(address: string): number | undefined {
  const trimmed = address.trim();
  const colon = trimmed.lastIndexOf(':');
  if (colon <= 0) return undefined;
  const port = Number.parseInt(trimmed.slice(colon + 1), 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return undefined;
  return port;
}

/** Client-side checks aligned with firmware MQTT::isValidConfig. */
export function validateMeshtasticMqttModuleApply(
  value: Record<string, unknown>,
  t: TFunction,
  deviceNetwork?: MeshtasticDeviceNetworkCapabilities,
): string | null {
  const enabled = cfgBool(value.enabled, false);
  if (!enabled) return null;

  const address = cfgStr(value.address, '').trim();
  if (!address) {
    return t('modulePanel.errors.mqttAddressRequired');
  }

  const tlsEnabled = cfgBool(value.tlsEnabled, false);
  if (isDefaultMeshtasticMqttServer(address) && tlsEnabled) {
    return t('modulePanel.errors.mqttDefaultServerTls');
  }

  const port = parseMeshtasticMqttAddressPort(address);
  if (isDefaultMeshtasticMqttServer(address) && port != null && port !== 1883 && port !== 8883) {
    return t('modulePanel.errors.mqttDefaultServerPort');
  }

  if (
    meshtasticDeviceRequiresMqttProxyToClient(deviceNetwork) &&
    !cfgBool(value.proxyToClientEnabled, false)
  ) {
    return t('modulePanel.errors.mqttProxyRequired');
  }

  return null;
}
