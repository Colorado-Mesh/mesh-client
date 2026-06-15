import type { MQTTSettings } from '@/renderer/lib/types';
import { MQTT_DEFAULT_RECONNECT_ATTEMPTS } from '@/shared/meshtasticMqttReconnect';

import { parseMeshtasticMqttAddressPort } from './meshtasticMqttModuleApply';

function cfgBool(v: unknown): boolean {
  return v === true;
}

function cfgStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** True when device MQTT module uses proxy-to-client (BLE/serial gateway). */
export function isMeshtasticMqttProxyActive(moduleConfigs: Record<string, unknown>): boolean {
  const mqtt = moduleConfigs.mqtt;
  if (!mqtt || typeof mqtt !== 'object') return false;
  const cfg = mqtt as Record<string, unknown>;
  return cfgBool(cfg.enabled) && cfgBool(cfg.proxyToClientEnabled);
}

/** Map device ModuleConfig.mqtt slice to Connection-tab MQTTSettings for proxy gateway. */
export function mqttSettingsFromMeshtasticModuleConfig(
  moduleConfigs: Record<string, unknown>,
): MQTTSettings | null {
  const mqtt = moduleConfigs.mqtt;
  if (!mqtt || typeof mqtt !== 'object') return null;
  const cfg = mqtt as Record<string, unknown>;
  if (!cfgBool(cfg.enabled) || !cfgBool(cfg.proxyToClientEnabled)) return null;

  const address = cfgStr(cfg.address).trim();
  if (!address) return null;

  const tlsEnabled = cfgBool(cfg.tlsEnabled);
  const parsedPort = parseMeshtasticMqttAddressPort(address);
  const host = address.includes(':') ? address.split(':')[0].trim() : address;
  const port = parsedPort ?? (tlsEnabled ? 8883 : 1883);

  let root = cfgStr(cfg.root).trim() || 'msh';
  if (!root.endsWith('/')) root = `${root}/`;

  return {
    server: host,
    port,
    username: cfgStr(cfg.username),
    password: cfgStr(cfg.password),
    topicPrefix: root,
    autoLaunch: false,
    maxRetries: MQTT_DEFAULT_RECONNECT_ATTEMPTS,
    tlsEnabled,
    mqttTransportProtocol: 'meshtastic',
  };
}
