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

/** Last relay sender id that parses as a finite node number (e.g. Reticulum dest). */
export function pickRelayDmToNode(relaySenderIds: readonly string[] | undefined): number | null {
  if (relaySenderIds == null || relaySenderIds.length === 0) return null;
  for (let i = relaySenderIds.length - 1; i >= 0; i--) {
    const n = Number(relaySenderIds[i]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Prefer the active protocol when the incident was heard on it (live send); otherwise target the
 * victim's *original* protocol (`protocolsSeen[0]`), not the latest relay protocol stamped on
 * `incident.protocol`.
 *
 * On a DM-only protocol that is not the origin, the victim's `senderId` is from another protocol —
 * DM the latest numeric relay id for that protocol, or fall back to the origin protocol.
 */
export function resolveIncidentAckRoute(
  incident: Pick<
    EmergencyIncident,
    'protocol' | 'protocolsSeen' | 'channel' | 'senderId' | 'relaySenderIds'
  >,
  activeProtocol: MeshProtocol,
  isDmOnly: (protocol: MeshProtocol) => boolean,
): IncidentAckRoute {
  const originProtocol = incident.protocolsSeen[0] ?? incident.protocol;
  const viaActiveProtocol = incident.protocolsSeen.includes(activeProtocol);
  let protocol = viaActiveProtocol ? activeProtocol : originProtocol;

  if (isDmOnly(protocol) && protocol !== originProtocol) {
    const relayNode = pickRelayDmToNode(incident.relaySenderIds);
    if (relayNode != null) {
      return { protocol, channel: 0, toNode: relayNode, viaActiveProtocol };
    }
    protocol = originProtocol;
  }

  const channel = protocol === originProtocol ? parseChannel(incident.channel) : 0;
  let toNode: number | null = null;
  if (isDmOnly(protocol)) {
    const sender = Number(incident.senderId);
    toNode = Number.isFinite(sender) ? sender : null;
  }
  return { protocol, channel, toNode, viaActiveProtocol };
}

/** Prefix for Incident Command ACK outbox rows (`ackIncident:<id>:…`). */
export const INCIDENT_ACK_VIEW_KEY_PREFIX = 'ackIncident:';

/** Build a viewKey that tags the row as an incident ACK for App-level drain + recordAck. */
export function incidentAckViewKey(
  incidentId: string,
  route: { toNode: number | null; channel: number },
): string {
  const dest = route.toNode != null ? `dm:${route.toNode}` : `ch:${route.channel}`;
  return `${INCIDENT_ACK_VIEW_KEY_PREFIX}${incidentId}:${dest}`;
}

/** Extract the incident id from an ACK outbox viewKey, or null when not an ACK row. */
export function parseIncidentAckViewKey(viewKey: string): string | null {
  if (!viewKey.startsWith(INCIDENT_ACK_VIEW_KEY_PREFIX)) return null;
  const rest = viewKey.slice(INCIDENT_ACK_VIEW_KEY_PREFIX.length);
  const colon = rest.indexOf(':');
  const id = colon < 0 ? rest : rest.slice(0, colon);
  return id.length > 0 ? id : null;
}
