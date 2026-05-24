import type { MQTTSettings } from '@/renderer/lib/types';

/** Whether the desktop MQTT client uses TLS for the current settings (native mqtts or wss). */
export function mqttUsesTls(settings: MQTTSettings): boolean {
  if (settings.useWebSocket === true) {
    return settings.tlsEnabled === true || (settings.tlsEnabled !== false && settings.port === 443);
  }
  return settings.tlsEnabled === true || (settings.tlsEnabled !== false && settings.port === 8883);
}
