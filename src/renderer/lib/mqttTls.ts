import type { MQTTSettings } from '@/renderer/lib/types';
import { mqttUsesTls as mqttUsesTlsShared } from '@/shared/mqttTls';

/** Whether the desktop MQTT client uses TLS for the current settings (native mqtts or wss). */
export function mqttUsesTls(settings: MQTTSettings): boolean {
  return mqttUsesTlsShared(settings);
}
