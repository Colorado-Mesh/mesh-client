/** Normalize Meshtastic MQTT topic prefix for subscribe/compare (trailing slash). */
export function normalizeMeshtasticMqttTopicPrefix(topicPrefix: string): string {
  const trimmed = topicPrefix.trim() || 'msh';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/** Read radio ModuleConfig.mqtt.root when present. */
export function meshtasticRadioMqttRootFromModuleConfigs(
  moduleConfigs: Record<string, unknown>,
): string | null {
  const mqtt = moduleConfigs.mqtt;
  if (!mqtt || typeof mqtt !== 'object') return null;
  const root = (mqtt as Record<string, unknown>).root;
  if (typeof root !== 'string') return null;
  const trimmed = root.trim();
  if (!trimmed) return null;
  return normalizeMeshtasticMqttTopicPrefix(trimmed);
}

/** True when Connection panel prefix and radio mqtt.root differ after normalization. */
export function meshtasticMqttTopicPrefixesDiverge(
  appTopicPrefix: string,
  radioRoot: string,
): boolean {
  return (
    normalizeMeshtasticMqttTopicPrefix(appTopicPrefix) !==
    normalizeMeshtasticMqttTopicPrefix(radioRoot)
  );
}

/** Prefer radio mqtt.root for live subscribe when it is more specific than the app prefix. */
export function overlayMeshtasticMqttTopicPrefixForRadio(
  appTopicPrefix: string,
  radioRoot: string,
): string {
  const app = normalizeMeshtasticMqttTopicPrefix(appTopicPrefix);
  const radio = normalizeMeshtasticMqttTopicPrefix(radioRoot);
  if (radio === app) return app;
  if (radio.startsWith(app)) return radio;
  return app;
}
