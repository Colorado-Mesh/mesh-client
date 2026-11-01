import { isValidLatLon } from '@/shared/geoCoords';
import {
  TAK_INCIDENT_CALLSIGN_MAX_LEN,
  TAK_INCIDENT_ID_RE,
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
  return (
    incident.status !== 'resolved' &&
    isValidLatLon(incident.lat, incident.lon) &&
    // An incident restored from storage may carry an id main would refuse with the rest.
    TAK_INCIDENT_ID_RE.test(incident.id)
  );
}

/** Control characters, which main refuses, and characters XML cannot hold (U+FFFE, U+FFFF, a lone surrogate). */
const NOT_PRINTABLE_RE = /[\p{Cc}\p{Cs}\uFFFE\uFFFF]/gu;
/** The same, but line feeds stay. */
const NOT_PRINTABLE_KEEP_LINES_RE = /[^\P{Cc}\n]|[\p{Cs}\uFFFE\uFFFF]/gu;

/** `text` with characters main or XML cannot take as spaces; `keepLines` keeps line feeds. */
function printable(text: string, keepLines = false): string {
  return text.replace(keepLines ? NOT_PRINTABLE_KEEP_LINES_RE : NOT_PRINTABLE_RE, ' ');
}

/** What decides ATAK's emergency alarm, when the user has turned it on. */
export interface TakIncidentAlarm {
  /** Whether a sender is blocked; their reports never sound it. */
  isBlocked: (incident: EmergencyIncident) => boolean;
}

/**
 * Incidents whose alarm was sounding at the last {@link takIncidentMarkers}: it keeps sounding
 * after the incident is seen. Building the same list twice gives the same alarms.
 */
let soundingAlarms: ReadonlySet<string> = new Set();

/** Forget which alarms are sounding, as main does when no sink is left; also for tests. */
export function resetTakIncidentAlarms(): void {
  soundingAlarms = new Set();
}

/** Whether the incident's distress beacon has been cancelled since it last opened. */
function beaconCancelled(incident: EmergencyIncident): boolean {
  let cancelled = false;
  for (const event of incident.events ?? []) {
    if (event.kind === 'beaconCancelled') cancelled = true;
    else if (event.kind === 'reopened') cancelled = false;
  }
  return cancelled;
}

/**
 * Whether ATAK's alarm should sound for an incident, as MeshCore TAK Bridge sounds it: a MAYDAY,
 * not a drill, not this station's own, from a sender who is not blocked, whose beacon has not
 * been cancelled. It starts only for one the app is alerting about too, still unseen: a report
 * from a throttled sender, or one read from history, is recorded already seen and stays quiet.
 * Once sounding it keeps sounding after it is seen, until the incident is resolved or one of the
 * rest stops being true.
 */
function soundsAlarm(incident: EmergencyIncident, alarm: TakIncidentAlarm): boolean {
  return (
    incident.severity === 0 &&
    !incident.isDrill &&
    incident.localOrigin !== true &&
    !alarm.isBlocked(incident) &&
    !beaconCancelled(incident) &&
    (soundingAlarms.has(incident.id) || incident.seenAt === undefined)
  );
}

/**
 * The open MECP emergencies to show on TAK clients' maps, the same ones as the app's map
 * (Layers → Emergency incidents): unresolved, with a position from the report or the sender's
 * last known one. Most severe first, then most recently heard, at most
 * {@link TAK_INCIDENT_MARKERS_MAX}. A resolved incident, or a cancelled beacon that resolved it,
 * drops off, and main deletes its marker. With `alarm`, a marker also asks main to sound ATAK's
 * emergency alarm (see {@link soundsAlarm}).
 */
export function takIncidentMarkers(
  incidents: Record<string, EmergencyIncident>,
  alarm?: TakIncidentAlarm,
): TakIncidentMarker[] {
  const markers: TakIncidentMarker[] = Object.values(incidents)
    .filter(isPlaced)
    .sort((a, b) => a.severity - b.severity || b.lastSeenAt - a.lastSeenAt)
    .slice(0, TAK_INCIDENT_MARKERS_MAX)
    // A sender's name is whatever the mesh carried: one line, with no control characters.
    .map((incident) => ({ ...incident, senderName: printable(incident.senderName) }))
    .map((incident) => {
      const name = incident.senderName.trim() || incident.senderId;
      return {
        id: incident.id,
        // Main refuses control characters; the remarks keep their line breaks.
        callsign: capTakText(
          printable(`${takMecpHeadline(incident.severity, incident.isDrill)} ${name}`).trim(),
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
        ...(alarm && soundsAlarm(incident, alarm)
          ? {
              // A name that is one overlong character caps to nothing, which main refuses.
              alarm:
                capTakText(printable(name).trim(), TAK_INCIDENT_CALLSIGN_MAX_LEN) || incident.id,
            }
          : {}),
      };
    });
  // Without the alarm turned on (or with no sink), nothing is sounding.
  soundingAlarms = new Set(markers.filter((m) => m.alarm !== undefined).map((m) => m.id));
  return markers;
}
