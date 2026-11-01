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
  return (
    eventHead(incidentMarkerUid(marker.id), SPOT_MARKER_TYPE, nowMs, INCIDENT_MARKER_STALE_MS) +
    point(marker) +
    `<detail><contact callsign="${escapeXml(marker.callsign)}"/>` +
    `<color argb="${incidentMarkerArgb(marker)}"/>` +
    `<remarks>${escapeXml(marker.remarks)}</remarks></detail>` +
    `</event>`
  );
}

function eventHead(uid: string, type: string, nowMs: number, staleMs: number): string {
  const time = new Date(nowMs).toISOString();
  return (
    `<event version="2.0" uid="${escapeXml(uid)}" type="${type}" time="${time}" start="${time}"` +
    ` stale="${new Date(nowMs + staleMs).toISOString()}" how="m-g">`
  );
}

function point(marker: Pick<TakIncidentMarker, 'lat' | 'lon'>): string {
  return (
    `<point lat="${marker.lat.toFixed(6)}" lon="${marker.lon.toFixed(6)}"` +
    ` hae="${UNKNOWN}" ce="${UNKNOWN}" le="${UNKNOWN}"/>`
  );
}

/**
 * ATAK's emergency alarm for a MAYDAY (`b-a-o-tbl`), or with `cancel` its cancel (`b-a-o-can`),
 * in the form ATAK sends its own and MeshCore TAK Bridge sends one: linked to the incident's
 * marker and named "<sender>-Alert". ATAK sounds it each time one arrives, so it is sent once.
 */
export function buildIncidentAlarmCot(
  marker: TakIncidentMarker,
  nowMs: number,
  cancel = false,
): string {
  const name = escapeXml(marker.alarm ?? marker.callsign);
  const uid = incidentMarkerUid(marker.id);
  // Left uncancelled (main gone), ATAK drops it when the marker would go stale.
  return (
    eventHead(
      `${uid}-alert`,
      'b-a-o-' + (cancel ? 'can' : 'tbl'),
      nowMs,
      INCIDENT_MARKER_STALE_MS,
    ) +
    point(marker) +
    `<detail>${
      cancel
        ? ''
        : `<link uid="${escapeXml(uid)}" type="${SPOT_MARKER_TYPE}" relation="p-p"/><contact callsign="${name}-Alert"/>`
    }<emergency ${cancel ? 'cancel="true"' : 'type="911 Alert"'}>${name}</emergency></detail></event>`
  );
}

/**
 * Validate the renderer's list of incident markers: at most {@link TAK_INCIDENT_MARKERS_MAX}, each
 * with an id main can use in a uid, a one-line callsign (and alarm name) of at most
 * {@link TAK_INCIDENT_CALLSIGN_MAX_LEN} printable characters, remarks of at most
 * {@link TAK_INCIDENT_REMARKS_MAX_LEN}, a position on the map, a severity 0-3 and a drill flag. An
 * alarm is taken only on a MAYDAY that is not a drill. Throws `tak:setIncidentMarkers: bad <field>`.
 */
export function parseTakIncidentMarkers(raw: unknown): TakIncidentMarker[] {
  const bad = (field: string) => new Error(`tak:setIncidentMarkers: bad ${field}`);
  if (!Array.isArray(raw) || raw.length > TAK_INCIDENT_MARKERS_MAX) throw bad('list');
  const oneLine = (v: unknown, field: string): string => {
    const text = typeof v === 'string' ? v.trim() : '';
    if (!text || text.length > TAK_INCIDENT_CALLSIGN_MAX_LEN || CONTROL_CHARS_RE.test(text)) {
      throw bad(field);
    }
    return text;
  };
  const byId = new Map<string, TakIncidentMarker>();
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== 'object') throw bad('marker');
    const m = item as Record<string, unknown>;
    if (typeof m.id !== 'string' || !TAK_INCIDENT_ID_RE.test(m.id)) throw bad('id');
    const callsign = oneLine(m.callsign, 'callsign');
    if (
      typeof m.remarks !== 'string' ||
      m.remarks.length > TAK_INCIDENT_REMARKS_MAX_LEN ||
      REMARKS_CONTROL_RE.test(m.remarks)
    ) {
      throw bad('remarks');
    }
    if (typeof m.lat !== 'number' || typeof m.lon !== 'number' || !isValidLatLon(m.lat, m.lon)) {
      throw bad('position');
    }
    const severity = m.severity as TakIncidentMarker['severity'];
    if (![0, 1, 2, 3].includes(severity)) throw bad('severity');
    if (typeof m.drill !== 'boolean') throw bad('drill');
    // The alarm is for a real MAYDAY only, whatever the renderer sends.
    if (m.alarm !== undefined && (severity || m.drill)) throw bad('alarm');
    const alarm = m.alarm === undefined ? undefined : oneLine(m.alarm, 'alarm');
    byId.set(m.id, {
      id: m.id,
      callsign,
      remarks: m.remarks,
      lat: m.lat,
      lon: m.lon,
      severity,
      drill: m.drill,
      ...(alarm !== undefined ? { alarm } : {}),
    });
  }
  return [...byId.values()];
}
