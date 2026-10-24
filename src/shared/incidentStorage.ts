import type { EmergencyIncident, IncidentSnapshot } from './incidentTypes';
import { isMeshProtocol } from './meshProtocol';

export const INCIDENT_STORE_KEY = 'mesh-client:incidents';
export const INCIDENT_STORAGE_VERSION = 3;
/** IPC/import safety limit; above normal retained history without enforcing the soft row cap. */
export const MAX_INCIDENT_STORAGE_BYTES = 16 * 1024 * 1024;

function assertIncidentStorageSize(raw: string): void {
  if (
    raw.length > MAX_INCIDENT_STORAGE_BYTES ||
    new TextEncoder().encode(raw).byteLength > MAX_INCIDENT_STORAGE_BYTES
  ) {
    throw new RangeError('Incident storage exceeds the 16 MiB limit');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

const EVENT_KINDS = new Set([
  'received',
  'relayHeard',
  'ackHeard',
  'ackSent',
  'beaconConfirmed',
  'beaconCancelled',
  'resolved',
  'reopened',
]);

/** Reject malformed persisted/IPC data instead of silently dropping emergency records. */
function isIncident(value: unknown, id: string): value is EmergencyIncident {
  if (!isRecord(value)) return false;
  return (
    value.id === id &&
    id.length > 0 &&
    typeof value.protocol === 'string' &&
    isMeshProtocol(value.protocol) &&
    isStringArray(value.protocolsSeen) &&
    value.protocolsSeen.every(isMeshProtocol) &&
    [0, 1, 2, 3].includes(value.severity as number) &&
    isStringArray(value.codes) &&
    typeof value.freetext === 'string' &&
    typeof value.senderId === 'string' &&
    typeof value.senderName === 'string' &&
    (value.channel === null || typeof value.channel === 'string') &&
    isFiniteNumber(value.receivedAt) &&
    isFiniteNumber(value.lastSeenAt) &&
    (value.coordsSource === null ||
      value.coordsSource === 'message' ||
      value.coordsSource === 'lastKnown') &&
    isStringArray(value.messageIds) &&
    isFiniteNumber(value.ackCount) &&
    isStringArray(value.ackPeerIds) &&
    typeof value.beaconActive === 'boolean' &&
    typeof value.beaconAcked === 'boolean' &&
    typeof value.isDrill === 'boolean' &&
    ['open', 'acked', 'resolved'].includes(value.status as string) &&
    ['lat', 'lon', 'resolvedAt', 'seenAt', 'beaconCancelToNode'].every(
      (key) => value[key] === undefined || isFiniteNumber(value[key]),
    ) &&
    (value.localOrigin === undefined || typeof value.localOrigin === 'boolean') &&
    (value.relaySenderIds === undefined || isStringArray(value.relaySenderIds)) &&
    (value.events === undefined ||
      (Array.isArray(value.events) &&
        value.events.every(
          (event: unknown) =>
            isRecord(event) &&
            isFiniteNumber(event.at) &&
            typeof event.kind === 'string' &&
            EVENT_KINDS.has(event.kind) &&
            (event.peerId === undefined || typeof event.peerId === 'string') &&
            (event.protocol === undefined ||
              (typeof event.protocol === 'string' && isMeshProtocol(event.protocol))),
        )))
  );
}

export function parseIncidentSnapshot(value: unknown): IncidentSnapshot {
  const raw = JSON.stringify(value);
  if (typeof raw !== 'string') throw new TypeError('Invalid incident storage snapshot');
  assertIncidentStorageSize(raw);
  if (
    !isRecord(value) ||
    !isRecord(value.incidents) ||
    !isRecord(value.resolvedTombstones) ||
    !Object.entries(value.incidents).every(([id, incident]) => isIncident(incident, id)) ||
    !Object.values(value.resolvedTombstones).every(isFiniteNumber)
  ) {
    throw new TypeError('Invalid incident storage snapshot');
  }
  return value as unknown as IncidentSnapshot;
}

/** The old Zustand envelope stays readable during file-origin recovery. */
export function parseLegacyIncidentStorage(raw: string | null): IncidentSnapshot {
  if (raw === null) return { incidents: {}, resolvedTombstones: {} };
  assertIncidentStorageSize(raw);
  const envelope: unknown = JSON.parse(raw);
  if (!isRecord(envelope) || !isRecord(envelope.state)) {
    throw new TypeError('Invalid legacy incident storage');
  }
  const version = envelope.version ?? 0;
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 0 ||
    version > INCIDENT_STORAGE_VERSION
  ) {
    throw new TypeError('Unsupported legacy incident storage version');
  }
  const snapshot = parseIncidentSnapshot({
    incidents: envelope.state.incidents ?? {},
    resolvedTombstones: envelope.state.resolvedTombstones ?? {},
  });
  if (version < INCIDENT_STORAGE_VERSION) {
    // Old rows predate the standing alert; upgrading must not start a new siren/banner.
    for (const incident of Object.values(snapshot.incidents)) {
      incident.seenAt ??= incident.lastSeenAt;
    }
  }
  return snapshot;
}
