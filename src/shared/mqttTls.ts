/** Minimal MQTT settings shape for TLS inference (main + renderer). */
export interface MqttTlsSettings {
  port: number;
  useWebSocket?: boolean;
  tlsEnabled?: boolean | null;
}

/** Whether the desktop MQTT client uses TLS for the current settings (native mqtts or wss). */
export function mqttUsesTls(settings: MqttTlsSettings): boolean {
  if (settings.useWebSocket === true) {
    return settings.tlsEnabled === true || (settings.tlsEnabled !== false && settings.port === 443);
  }
  return settings.tlsEnabled === true || (settings.tlsEnabled !== false && settings.port === 8883);
}
