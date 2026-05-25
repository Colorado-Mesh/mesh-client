export type MqttOnlyIdentitySource = 'lastRf' | 'virtual';

/** MQTT-only sender: prefer last BLE node id when available, else persisted virtual id. */
export function resolveMqttOnlyFromNodeId(lastRfSelfNodeId: number, virtualNodeId: number): number {
  return lastRfSelfNodeId > 0 ? lastRfSelfNodeId : virtualNodeId;
}

export function mqttOnlyIdentitySource(lastRfSelfNodeId: number): MqttOnlyIdentitySource {
  return lastRfSelfNodeId > 0 ? 'lastRf' : 'virtual';
}
