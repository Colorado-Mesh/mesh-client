import { isValidLatLon } from '../../shared/geoCoords';
import {
  TAK_INCIDENT_CALLSIGN_MAX_LEN,
  TAK_INCIDENT_ID_RE,
  TAK_INCIDENT_MARKERS_MAX,
  TAK_INCIDENT_REMARKS_MAX_LEN,
  type TakIncidentMarker,
} from '../../shared/tak-types';
import { escapeXml } from '../../shared/xmlEscape';

/** ATAK's spot marker, which takes a colour. */
const SPOT_MARKER_TYPE = 'b-m-p-s-m';
/** How long ATAK keeps a marker without a refresh; main refreshes well inside it. */
export const INCIDENT_MARKER_STALE_MS = 30 * 60 * 1000;
const UNKNOWN = '9999999.0';
const CONTROL_CHARS_RE = /[\p{Cc}]/u;
/** Line breaks are kept in remarks; other control characters are not. */
const REMARKS_CONTROL_RE = /[^\P{Cc}\n]/u;

/**
 * Spot marker colours as ATAK's signed ARGB, by severity: red for MAYDAY, orange for URGENT,
 * yellow for SAFETY, white for ROUTINE; grey for a drill. The same as MeshCore TAK Bridge.
 */
const SEVERITY_ARGB = [0xffff0000 | 0, 0xffff8c00 | 0, 0xffffd700 | 0, 0xffffffff | 0] as const;
const DRILL_ARGB = 0xffa0a0a0 | 0;

/** The marker's uid in ATAK, from the incident's id. */
export function incidentMarkerUid(id: string): string {
  return `mesh-client-${id}`;
}

export function incidentMarkerArgb(marker: Pick<TakIncidentMarker, 'severity' | 'drill'>): number {
  return marker.drill ? DRILL_ARGB : SEVERITY_ARGB[marker.severity];
}

/** A spot marker for one open MECP emergency. */
export function buildIncidentMarkerCot(marker: TakIncidentMarker, nowMs: number): string {
  const time = new Date(nowMs).toISOString();
  const stale = new Date(nowMs + INCIDENT_MARKER_STALE_MS).toISOString();
  return (
    `<event version="2.0" uid="${escapeXml(incidentMarkerUid(marker.id))}" type="${SPOT_MARKER_TYPE}"` +
    ` time="${time}" start="${time}" stale="${stale}" how="m-g">` +
    `<point lat="${marker.lat.toFixed(6)}" lon="${marker.lon.toFixed(6)}"` +
    ` hae="${UNKNOWN}" ce="${UNKNOWN}" le="${UNKNOWN}"/>` +
    `<detail><contact callsign="${escapeXml(marker.callsign)}"/>` +
    `<color argb="${incidentMarkerArgb(marker)}"/>` +
    `<remarks>${escapeXml(marker.remarks)}</remarks></detail>` +
    `</event>`
  );
}

/** Validate the renderer's list of incident markers. Throws when malformed. */
export function parseTakIncidentMarkers(raw: unknown): TakIncidentMarker[] {
  const bad = (why: string) => new Error(`tak:setIncidentMarkers: ${why}`);
  if (!Array.isArray(raw) || raw.length > TAK_INCIDENT_MARKERS_MAX) {
    throw bad(`expected an array of at most ${TAK_INCIDENT_MARKERS_MAX} markers`);
  }
  const byId = new Map<string, TakIncidentMarker>();
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== 'object') throw bad('each marker must be an object');
    const m = item as Record<string, unknown>;
    if (typeof m.id !== 'string' || !TAK_INCIDENT_ID_RE.test(m.id)) throw bad('bad incident id');
    const callsign = typeof m.callsign === 'string' ? m.callsign.trim() : '';
    if (
      !callsign ||
      callsign.length > TAK_INCIDENT_CALLSIGN_MAX_LEN ||
      CONTROL_CHARS_RE.test(callsign)
    ) {
      throw bad(`callsign must be 1-${TAK_INCIDENT_CALLSIGN_MAX_LEN} printable characters`);
    }
    if (
      typeof m.remarks !== 'string' ||
      m.remarks.length > TAK_INCIDENT_REMARKS_MAX_LEN ||
      REMARKS_CONTROL_RE.test(m.remarks)
    ) {
      throw bad(`remarks must be at most ${TAK_INCIDENT_REMARKS_MAX_LEN} characters`);
    }
    if (typeof m.lat !== 'number' || typeof m.lon !== 'number' || !isValidLatLon(m.lat, m.lon)) {
      throw bad('lat and lon must be a valid position');
    }
    if (m.severity !== 0 && m.severity !== 1 && m.severity !== 2 && m.severity !== 3) {
      throw bad('severity must be 0-3');
    }
    if (typeof m.drill !== 'boolean') throw bad('drill must be a boolean');
    byId.set(m.id, {
      id: m.id,
      callsign,
      remarks: m.remarks,
      lat: m.lat,
      lon: m.lon,
      severity: m.severity,
      drill: m.drill,
    });
  }
  return [...byId.values()];
}
