import {
  resolveIdentityIdForProtocol,
  resolvePrimaryIdentityIdForProtocol,
} from '../lib/identityByProtocol';
import type { MeshProtocol, MQTTStatus } from '../lib/types';
import { setConnection } from './connectionStore';
import { useIdentityStore } from './identityStore';

/** Mirror MQTT IPC status onto every identity bucket the UI may read for a protocol tab. */
export function mirrorMqttStatusForProtocol(protocol: MeshProtocol, status: MQTTStatus): void {
  const { identities, activeIdentityId } = useIdentityStore.getState();
  const resolved = resolveIdentityIdForProtocol(identities, activeIdentityId, protocol);
  const primary = resolvePrimaryIdentityIdForProtocol(identities, activeIdentityId, protocol);
  const targets = new Set([resolved, primary].filter(Boolean));
  for (const id of targets) {
    setConnection(id!, { mqttStatus: status });
  }
}
