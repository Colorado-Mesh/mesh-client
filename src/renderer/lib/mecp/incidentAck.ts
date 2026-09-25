import type { MeshProtocol } from '@/shared/meshProtocol';

import type { EmergencyIncident } from './incidentTypes';
import { composeBeaconAck, composeGeneralAck } from './mecpAck';

/** Same predicate as `AckIncidentButton` so the button label and wire payload always agree. */
export function incidentNeedsBeaconAck(
  incident: Pick<EmergencyIncident, 'beaconActive' | 'beaconAcked'>,
): boolean {
  return incident.beaconActive && !incident.beaconAcked;
}

/** B02 for an unacknowledged active beacon, otherwise a general R01 ACK echoing the codes. */
export function composeIncidentAck(
  incident: Pick<EmergencyIncident, 'severity' | 'codes' | 'beaconActive' | 'beaconAcked'>,
  opts?: { callsign?: string },
): string {
  return incidentNeedsBeaconAck(incident)
    ? composeBeaconAck(incident.severity)
    : composeGeneralAck(incident.severity, incident.codes, { callsign: opts?.callsign });
}

export interface IncidentAckRoute {
  protocol: MeshProtocol;
  channel: number;
  /** Set for DM-only protocols (Reticulum): the ACK goes straight back to the sender. */
  toNode: number | null;
  /** True when the ACK can go out live on the active protocol's send path. */
  viaActiveProtocol: boolean;
}

function parseChannel(channel: string | null): number {
  if (channel == null) return 0;
  const n = Number(channel);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * Prefer the active protocol when the incident was heard on it (live send); otherwise target the
 * protocol of the latest copy, which the caller should enqueue for that protocol's outbox drain.
 */
export function resolveIncidentAckRoute(
  incident: Pick<EmergencyIncident, 'protocol' | 'protocolsSeen' | 'channel' | 'senderId'>,
  activeProtocol: MeshProtocol,
  isDmOnly: (protocol: MeshProtocol) => boolean,
): IncidentAckRoute {
  const viaActiveProtocol = incident.protocolsSeen.includes(activeProtocol);
  const protocol = viaActiveProtocol ? activeProtocol : incident.protocol;
  const channel = protocol === incident.protocol ? parseChannel(incident.channel) : 0;
  const sender = Number(incident.senderId);
  const toNode = isDmOnly(protocol) && Number.isFinite(sender) ? sender : null;
  return { protocol, channel, toNode, viaActiveProtocol };
}
