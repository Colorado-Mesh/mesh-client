import { setConnection } from '../../stores/connectionStore';
import type { IdentityId, MQTTStatus } from '../types';

/** Mirrors MQTT IPC status into the identity-scoped connection store. */
export function mirrorMqttStatusToConnection(
  identityId: IdentityId | null,
  status: MQTTStatus,
): void {
  if (identityId) {
    setConnection(identityId, { mqttStatus: status });
  }
}
