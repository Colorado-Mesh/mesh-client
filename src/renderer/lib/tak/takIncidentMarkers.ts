import { isValidLatLon } from '@/shared/geoCoords';
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

/**
 * Unresolved, with a position on the map: the incidents the app's own map shows. A sender's last
 * known position comes from contacts that are not range-checked first, and main refuses the whole
 * list for one bad position, so it is checked here.
 */
function isPlaced(incident: EmergencyIncident): incident is PlacedIncident {
  return incident.status !== 'resolved' && isValidLatLon(incident.lat, incident.lon);
}

/** `text` with control characters as spaces, which main refuses; `keepLines` keeps line feeds. */
function printable(text: string, keepLines = false): string {
  return text.replace(keepLines ? /[^\P{Cc}\n]/gu : /\p{Cc}/gu, ' ');
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
  return (
    Object.values(incidents)
      .filter(isPlaced)
      .sort((a, b) => a.severity - b.severity || b.lastSeenAt - a.lastSeenAt)
      .slice(0, TAK_INCIDENT_MARKERS_MAX)
      // A sender's name is whatever the mesh carried: one line, with no control characters.
      .map((incident) => ({ ...incident, senderName: printable(incident.senderName) }))
      .map((incident) => ({
        id: incident.id,
        // Main refuses control characters; the remarks keep their line breaks.
        callsign: capTakText(
          printable(
            `${takMecpHeadline(incident.severity, incident.isDrill)} ${
              incident.senderName.trim() || incident.senderId
            }`,
          ).trim(),
          TAK_INCIDENT_CALLSIGN_MAX_LEN,
        ),
        remarks: capTakText(
          printable(takIncidentRemarks(incident), true),
          TAK_INCIDENT_REMARKS_MAX_LEN,
        ),
        lat: incident.lat,
        lon: incident.lon,
        severity: incident.severity,
        drill: incident.isDrill,
      }))
  );
}
