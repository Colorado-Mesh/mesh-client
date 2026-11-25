import type { MQTTStatus } from './types';

/**
 * Whether the MeshCom Connection MQTT `SettingsCollapsible` should start open.
 * Empty installs stay collapsed — national MQTT is usually via the node gateway.
 */
export function shouldOpenMeshcomMqttPanel(opts: {
  server: string;
  profileCount: number;
  mqttStatus: MQTTStatus;
}): boolean {
  return (
    Boolean(opts.server.trim()) ||
    opts.profileCount > 0 ||
    opts.mqttStatus === 'connected' ||
    opts.mqttStatus === 'connecting'
  );
}
