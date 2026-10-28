import {
  TAK_INCIDENT_CALLSIGN_MAX_LEN,
  TAK_INCIDENT_MARKERS_MAX,
  TAK_INCIDENT_REMARKS_MAX_LEN,
  type TakIncidentMarker,
} from '@/shared/tak-types';

import type { EmergencyIncident } from '../mecp/incidentTypes';
import { takIncidentRemarks, takMecpHeadline } from './takMecpText';
import { capTakText } from './takReplyText';

type PlacedIncident = EmergencyIncident & { lat: number; lon: number };

/** Unresolved, with a position: the incidents the app's own map shows. */
function isPlaced(incident: EmergencyIncident): incident is PlacedIncident {
  return (
    incident.status !== 'resolved' &&
    typeof incident.lat === 'number' &&
    typeof incident.lon === 'number' &&
    Number.isFinite(incident.lat) &&
    Number.isFinite(incident.lon)
  );
}

/**
 * The open MECP emergencies to show on TAK clients' maps, the same ones as the app's map
 * (Layers → Emergency incidents): unresolved, with a position from the report or the sender's
 * last known one. Most severe first, then most recently heard, at most
 * {@link TAK_INCIDENT_MARKERS_MAX}. A resolved incident, or a cancelled beacon that resolved it,
 * drops off, and main deletes its marker.
 */
export function takIncidentMarkers(
  incidents: Record<string, EmergencyIncident>,
): TakIncidentMarker[] {
  return Object.values(incidents)
    .filter(isPlaced)
    .sort((a, b) => a.severity - b.severity || b.lastSeenAt - a.lastSeenAt)
    .slice(0, TAK_INCIDENT_MARKERS_MAX)
    .map((incident) => ({
      id: incident.id,
      callsign: capTakText(
        `${takMecpHeadline(incident.severity, incident.isDrill)} ${
          incident.senderName.trim() || incident.senderId
        }`,
        TAK_INCIDENT_CALLSIGN_MAX_LEN,
      ),
      remarks: capTakText(takIncidentRemarks(incident), TAK_INCIDENT_REMARKS_MAX_LEN),
      lat: incident.lat,
      lon: incident.lon,
      severity: incident.severity,
      drill: incident.isDrill,
    }));
}
