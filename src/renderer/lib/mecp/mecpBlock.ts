import type { EmergencyIncident } from '@/renderer/lib/mecp/incidentTypes';
import { useIncidentStore } from '@/renderer/stores/incidentStore';
import { useMecpBlockStore } from '@/renderer/stores/mecpBlockStore';
import type { MeshProtocol } from '@/shared/meshProtocol';

/** Protocol the victim was first heard on; relays may have moved `incident.protocol` since. */
export function incidentOriginProtocol(incident: EmergencyIncident): MeshProtocol {
  return incident.protocolsSeen[0] ?? incident.protocol;
}

/**
 * Block MECP alerts from the sender of `incident`. With `resolveOpen`, also resolve (locally,
 * no transmit) every unresolved incident that sender raised on the same protocol.
 * Returns the number of incidents resolved.
 */
export function blockMecpIncidentSender(
  incident: EmergencyIncident,
  opts?: { resolveOpen?: boolean },
): number {
  const protocol = incidentOriginProtocol(incident);
  useMecpBlockStore.getState().block(protocol, incident.senderId, incident.senderName);
  if (!opts?.resolveOpen) return 0;
  const store = useIncidentStore.getState();
  let resolved = 0;
  for (const inc of Object.values(store.incidents)) {
    if (
      inc.status === 'resolved' ||
      inc.localOrigin === true ||
      inc.senderId !== incident.senderId ||
      incidentOriginProtocol(inc) !== protocol
    ) {
      continue;
    }
    store.resolveIncident(inc.id);
    resolved++;
  }
  return resolved;
}
