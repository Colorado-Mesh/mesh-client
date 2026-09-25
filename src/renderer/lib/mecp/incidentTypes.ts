import type { MeshProtocol } from '@/shared/meshProtocol';

import type { Severity } from './engine';

export type IncidentStatus = 'open' | 'acked' | 'resolved';

export type IncidentCoordsSource = 'message' | 'lastKnown' | null;

export interface EmergencyIncident {
  /** `incidentFingerprint()` of the first report (stable across severity escalation). */
  id: string;
  /** Protocol the latest copy arrived on. */
  protocol: MeshProtocol;
  protocolsSeen: MeshProtocol[];
  severity: Severity;
  codes: string[];
  freetext: string;
  senderId: string;
  senderName: string;
  /** Bridge / relay node ids that forwarded a copy (original senderId stays the victim). */
  relaySenderIds?: string[];
  channel: string | null;
  receivedAt: number;
  lastSeenAt: number;
  lat?: number;
  lon?: number;
  coordsSource: IncidentCoordsSource;
  messageIds: string[];
  ackCount: number;
  ackPeerIds: string[];
  beaconActive: boolean;
  beaconAcked: boolean;
  /**
   * This station transmitted the beacon. Not on the wire — receivers match B03 by sender id.
   * Optional so rows saved before beacon cancel still load.
   */
  localOrigin?: boolean;
  /**
   * Unicast destination of an originated beacon. Absent means the cancel is a channel broadcast.
   */
  beaconCancelToNode?: number;
  isDrill: boolean;
  status: IncidentStatus;
  resolvedAt?: number;
}
