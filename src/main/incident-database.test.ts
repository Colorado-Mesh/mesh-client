import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_INCIDENT_STORAGE_BYTES } from '../shared/incidentStorage';
import type { EmergencyIncident, IncidentSnapshot } from '../shared/incidentTypes';
import { REGISTERED_MESH_PROTOCOLS } from '../shared/meshProtocol';
import { NodeSqliteDB } from './db-compat';
import { runSchemaUpgrade } from './db-schema-sync';
import { getIncidentsOn, saveIncidentsOn, seedIncidentsOn } from './incident-database';

function incident(id = 'incident'): EmergencyIncident {
  return {
    id,
    protocol: 'meshtastic',
    protocolsSeen: ['meshtastic'],
    severity: 0,
    codes: ['M01'],
    freetext: 'help',
    senderId: '!victim',
    senderName: 'Victim',
    channel: 'LongFast',
    receivedAt: 1_000,
    lastSeenAt: 2_000,
    coordsSource: null,
    messageIds: ['msg'],
    ackCount: 0,
    ackPeerIds: [],
    beaconActive: false,
    beaconAcked: false,
    isDrill: false,
    status: 'open',
    events: [{ at: 1_000, kind: 'received', protocol: 'meshtastic' }],
  };
}

function snapshot(): IncidentSnapshot {
  return { incidents: { incident: incident() }, resolvedTombstones: { resolved: 1_500 } };
}

function legacy(state = snapshot(), version = 3): string {
  return JSON.stringify({ state, version });
}

describe('durable incident storage', () => {
  let db: NodeSqliteDB;

  beforeEach(() => {
    db = new NodeSqliteDB(':memory:');
    runSchemaUpgrade(db);
  });

  afterEach(() => {
    db.close();
  });

  it.each(REGISTERED_MESH_PROTOCOLS)('round-trips incidents and tombstones for %s', (protocol) => {
    const state = snapshot();
    state.incidents.incident.protocol = protocol;
    state.incidents.incident.protocolsSeen = [protocol];
    saveIncidentsOn(db, state);
    expect(getIncidentsOn(db)).toEqual(state);
    expect(db.prepare('SELECT id, status, last_seen_at FROM emergency_incidents').get()).toEqual({
      id: 'incident',
      status: 'open',
      last_seen_at: 2_000,
    });
  });

  it.each(['linux', 'darwin', 'win32'])(
    'creates the tables on existing v52 databases on %s',
    () => {
      db.execScript(`DROP TABLE emergency_incidents;
      DROP TABLE emergency_incident_tombstones;
      DROP TABLE emergency_incident_storage;`);
      db.pragma('user_version = 52');
      runSchemaUpgrade(db);
      seedIncidentsOn(db, legacy());
      runSchemaUpgrade(db);
      expect(getIncidentsOn(db)).toEqual(snapshot());
      expect(
        db
          .prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_emergency_incidents_status_time'")
          .get(),
      ).toBeTruthy();
    },
  );

  it('seeds legacy storage once and preserves the canonical state after localStorage is wiped', () => {
    expect(seedIncidentsOn(db, legacy())).toEqual(snapshot());
    const changed = snapshot();
    changed.incidents.incident.status = 'resolved';
    changed.incidents.incident.resolvedAt = 3_000;
    saveIncidentsOn(db, changed);
    expect(seedIncidentsOn(db, null)).toEqual(changed);
    expect(seedIncidentsOn(db, legacy())).toEqual(changed);
  });

  it('does not resurrect cleared incidents from an old origin export', () => {
    seedIncidentsOn(db, legacy());
    const cleared = { incidents: {}, resolvedTombstones: { incident: 4_000 } };
    saveIncidentsOn(db, cleared);
    expect(seedIncidentsOn(db, legacy())).toEqual(cleared);
    expect(seedIncidentsOn(db, 'invalid stale cache')).toEqual(cleared);
  });

  it('marks an empty first import complete so later stale storage cannot seed it', () => {
    seedIncidentsOn(db, null);
    expect(seedIncidentsOn(db, legacy())).toEqual({ incidents: {}, resolvedTombstones: {} });
  });

  it('imports pre-v3 incidents as seen without modifying the legacy envelope', () => {
    const raw = legacy(snapshot(), 2);
    const result = seedIncidentsOn(db, raw);
    expect(result.incidents.incident.seenAt).toBe(2_000);
    expect(JSON.parse(raw).state.incidents.incident.seenAt).toBeUndefined();
  });

  it('rejects invalid imports without marking them complete or changing data', () => {
    expect(() => seedIncidentsOn(db, '{')).toThrow();
    expect(db.prepare('SELECT * FROM emergency_incident_storage').all()).toEqual([]);
    expect(seedIncidentsOn(db, legacy())).toEqual(snapshot());
  });

  it('validates all records before replacing any existing data', () => {
    seedIncidentsOn(db, legacy());
    expect(() => {
      saveIncidentsOn(db, { incidents: { broken: {} }, resolvedTombstones: {} });
    }).toThrow();
    expect(getIncidentsOn(db)).toEqual(snapshot());
  });

  it('rejects oversized legacy input before parsing and leaves migration retryable', () => {
    expect(() => seedIncidentsOn(db, ' '.repeat(MAX_INCIDENT_STORAGE_BYTES + 1))).toThrow('16 MiB');
    expect(db.prepare('SELECT * FROM emergency_incident_storage').all()).toEqual([]);
    expect(seedIncidentsOn(db, legacy())).toEqual(snapshot());
  });

  it('rejects an oversized UTF-8 snapshot without replacing existing records', () => {
    seedIncidentsOn(db, legacy());
    const oversized = snapshot();
    oversized.incidents.incident.freetext = '💥'.repeat(MAX_INCIDENT_STORAGE_BYTES / 4);
    expect(() => {
      saveIncidentsOn(db, oversized);
    }).toThrow('16 MiB');
    expect(getIncidentsOn(db)).toEqual(snapshot());
  });

  it('rolls back row deletion when a write fails', () => {
    seedIncidentsOn(db, legacy());
    db.execScript(`CREATE TRIGGER fail_incident_write BEFORE INSERT ON emergency_incidents
      BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;`);
    expect(() => {
      saveIncidentsOn(db, snapshot());
    }).toThrow('simulated write failure');
    expect(getIncidentsOn(db)).toEqual(snapshot());
  });

  it('fails reads on corrupt persisted rows instead of returning a destructive empty snapshot', () => {
    seedIncidentsOn(db, legacy());
    db.prepare('UPDATE emergency_incidents SET payload = ?').run('{');
    expect(() => getIncidentsOn(db)).toThrow();
  });
});
