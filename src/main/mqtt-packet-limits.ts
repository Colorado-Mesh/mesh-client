import type { IClientOptions } from 'mqtt';

/** Maximum complete MQTT packet and WebSocket message accepted from an untrusted broker. */
export const MQTT_MAX_PACKET_BYTES = 1024 * 1024;

export const MQTT_PACKET_TOO_LARGE_ERROR_CODE = 'MQTT_PACKET_TOO_LARGE';

/** Error code emitted by `ws` when a complete message exceeds `maxPayload`. */
export const MQTT_WEBSOCKET_PACKET_TOO_LARGE_ERROR_CODE = 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH';

export type PacketLimitedMqttClientOptions = IClientOptions & {
  /** Consumed by the repository patch for mqtt-packet 9.0.2. */
  maximumPacketSize: number;
};

export function isMqttPacketTooLargeError(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('code' in value)) return false;
  return (
    value.code === MQTT_PACKET_TOO_LARGE_ERROR_CODE ||
    value.code === MQTT_WEBSOCKET_PACKET_TOO_LARGE_ERROR_CODE
  );
}

export function mqttPayloadByteLength(payload: Buffer | string): number {
  return Buffer.isBuffer(payload) ? payload.length : Buffer.byteLength(payload);
}

export function mqttPacketTooLargeMessage(): string {
  return `Broker sent an MQTT packet larger than the ${MQTT_MAX_PACKET_BYTES}-byte safety limit; automatic reconnect is disabled.`;
}
