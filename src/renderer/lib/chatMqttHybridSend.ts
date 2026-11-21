import type { MeshProtocol } from './types';

/**
 * Whether an MQTT-only link can carry chat sends for this protocol.
 * MeshCore and MeshCom may ingest MQTT but do not transmit chat over MQTT alone.
 */
export function protocolMqttProvidesChatSend(protocol: MeshProtocol): boolean {
  return protocol === 'meshtastic';
}
