import { parseIncidentSnapshot, parseLegacyIncidentStorage } from '../shared/incidentStorage';
import type { EmergencyIncident, IncidentSnapshot } from '../shared/incidentTypes';
import type { NodeSqliteDB } from './db-compat';

/** Read errors propagate: an unreadable record must never become an empty replacement. */
export function getIncidentsOn(db: NodeSqliteDB): IncidentSnapshot {
  const rows = db.prepare('SELECT id, payload FROM emergency_incidents').all() as {
    id: string;
    payload: string;
  }[];
  const tombstones = db
    .prepare('SELECT id, resolved_at FROM emergency_incident_tombstones')
    .all() as { id: string; resolved_at: number }[];
  return parseIncidentSnapshot({
    incidents: Object.fromEntries(rows.map((row) => [row.id, JSON.parse(row.payload)])),
    resolvedTombstones: Object.fromEntries(tombstones.map((row) => [row.id, row.resolved_at])),
  });
}

function writeSnapshot(db: NodeSqliteDB, snapshot: IncidentSnapshot, seed: boolean): void {
  const insert = db.prepare(
    `INSERT ${seed ? 'OR IGNORE ' : ''}INTO emergency_incidents
      (id, status, last_seen_at, payload) VALUES (?, ?, ?, ?)`,
  );
  for (const incident of Object.values(snapshot.incidents)) {
    insertIncident(insert, incident);
  }
  const tombstone = db.prepare(
    `INSERT ${seed ? 'OR IGNORE ' : ''}INTO emergency_incident_tombstones
      (id, resolved_at) VALUES (?, ?)`,
  );
  for (const [id, at] of Object.entries(snapshot.resolvedTombstones)) tombstone.run(id, at);
  db.prepare(
    'INSERT OR REPLACE INTO emergency_incident_storage (id, initialized) VALUES (1, 1)',
  ).run();
}

function insertIncident(
  insert: ReturnType<NodeSqliteDB['prepare']>,
  incident: EmergencyIncident,
): void {
  insert.run(incident.id, incident.status, incident.lastSeenAt, JSON.stringify(incident));
}

/** Snapshot replacement is atomic, including deletes, clearAll and resolution tombstones. */
export function saveIncidentsOn(db: NodeSqliteDB, value: unknown): void {
  const snapshot = parseIncidentSnapshot(value);
  db.transaction(() => {
    db.prepare('DELETE FROM emergency_incidents').run();
    db.prepare('DELETE FROM emergency_incident_tombstones').run();
    writeSnapshot(db, snapshot, false);
  })();
}

/** Seed once even for an empty store; stale origin exports cannot resurrect deleted rows. */
export function seedIncidentsOn(db: NodeSqliteDB, legacyJson: unknown): IncidentSnapshot {
  db.transaction(() => {
    if (db.prepare('SELECT 1 FROM emergency_incident_storage WHERE id = 1').get()) return;
    if (legacyJson !== null && typeof legacyJson !== 'string') {
      throw new TypeError('Legacy incident storage must be a string or null');
    }
    writeSnapshot(db, parseLegacyIncidentStorage(legacyJson), true);
  })();
  return getIncidentsOn(db);
}
