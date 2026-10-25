// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DURABLE_RENDERER_SETTING_MAX_LENGTH,
  DURABLE_RENDERER_STORAGE_KEYS,
  DURABLE_RENDERER_STORAGE_MIGRATIONS,
} from '../shared/rendererOrigin';
import { NodeSqliteDB } from './db-compat';
import { runSchemaUpgrade } from './db-schema-sync';
import { resetDurableRendererData, seedDurableRendererSettings } from './durableRendererSettings';
import { getIncidentsOn, seedIncidentsOn } from './incident-database';

describe('legacy renderer settings migration', () => {
  let db: NodeSqliteDB;

  beforeEach(() => {
    db = new NodeSqliteDB(':memory:');
    db.execScript('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  });

  afterEach(() => {
    db.close();
  });

  it('copies every durable namespace while leaving unrelated settings out', () => {
    const entries = Object.fromEntries(
      DURABLE_RENDERER_STORAGE_MIGRATIONS.map(([legacy]) => [legacy, JSON.stringify({ legacy })]),
    );
    entries['mesh-client:chatMacros'] = 'macros stay in web storage';
    seedDurableRendererSettings(db, entries);
    expect(db.prepareOnce('SELECT key, value FROM app_settings ORDER BY key').all()).toEqual(
      DURABLE_RENDERER_STORAGE_MIGRATIONS.map(([legacy, key]) => ({
        key,
        value: entries[legacy],
      })).sort((a, b) => a.key.localeCompare(b.key)),
    );
  });

  it('keeps newer SQLite values when an old export is replayed', () => {
    const [legacy, key] = DURABLE_RENDERER_STORAGE_MIGRATIONS[0];
    seedDurableRendererSettings(db, { [legacy]: '{"channel":10}' });
    db.prepareOnce('UPDATE app_settings SET value = ? WHERE key = ?').run('{"channel":20}', key);
    seedDurableRendererSettings(db, { [legacy]: '{"channel":10}' });
    expect(db.prepareOnce('SELECT value FROM app_settings WHERE key = ?').get(key)).toEqual({
      value: '{"channel":20}',
    });
  });

  it('seeds browser-only false main-process flags before their default-true consumers read them', () => {
    seedDurableRendererSettings(db, {
      'mesh-client:appSettings': '{"closeToTray":false,"autoUpdateDownloadEnabled":false}',
    });
    const rows = db.prepareOnce('SELECT key, value FROM app_settings ORDER BY key').all();
    expect(rows).toEqual([
      { key: 'autoUpdateDownloadEnabled', value: '0' },
      { key: 'closeToTray', value: '0' },
    ]);
    seedDurableRendererSettings(db, {
      'mesh-client:appSettings': '{"closeToTray":true,"autoUpdateDownloadEnabled":true}',
    });
    expect(db.prepareOnce('SELECT key, value FROM app_settings ORDER BY key').all()).toEqual(rows);
  });

  it('seeds Meshtastic from the unsuffixed map on legacy-only installations', () => {
    seedDurableRendererSettings(db, { 'mesh-client:lastRead': '{"ch:0":100}' });
    expect(
      db.prepareOnce('SELECT value FROM app_settings WHERE key = ?').get('chatLastRead:meshtastic'),
    ).toEqual({ value: '{"ch:0":100}' });
  });

  it('merges the greatest valid watermark from both Meshtastic maps only on first seed', () => {
    const entries = {
      'mesh-client:lastRead': '{"ch:0":100,"ch:1":500,"dm:7":300,"invalid":"oops"}',
      'mesh-client:lastRead:meshtastic': '{"ch:0":200,"ch:1":50}',
    };
    seedDurableRendererSettings(db, entries);
    const read = () =>
      db
        .prepareOnce('SELECT value FROM app_settings WHERE key = ?')
        .get('chatLastRead:meshtastic') as { value: string };
    expect(JSON.parse(read().value)).toEqual({ 'ch:0': 200, 'ch:1': 500, 'dm:7': 300 });
    db.prepareOnce('UPDATE app_settings SET value = ? WHERE key = ?').run(
      '{}',
      'chatLastRead:meshtastic',
    );
    seedDurableRendererSettings(db, entries);
    expect(read()).toEqual({ value: '{}' });
  });

  it('keeps a valid protocol-specific map when the legacy JSON is corrupt', () => {
    seedDurableRendererSettings(db, {
      'mesh-client:lastRead': 'corrupt',
      'mesh-client:lastRead:meshtastic': '{"ch:0":200}',
    });
    expect(
      db.prepareOnce('SELECT value FROM app_settings WHERE key = ?').get('chatLastRead:meshtastic'),
    ).toEqual({ value: '{"ch:0":200}' });
  });

  it('rolls back the seed on an oversized legacy setting so migration can fall back', () => {
    const [first] = DURABLE_RENDERER_STORAGE_MIGRATIONS[0];
    const [second] = DURABLE_RENDERER_STORAGE_MIGRATIONS[1];
    expect(() => {
      seedDurableRendererSettings(db, {
        [first]: '{}',
        [second]: 'x'.repeat(DURABLE_RENDERER_SETTING_MAX_LENGTH + 1),
      });
    }).toThrow('storage limit');
    expect(db.prepareOnce('SELECT COUNT(*) AS count FROM app_settings').get()).toEqual({
      count: 0,
    });
  });
});

describe('explicit durable renderer data reset', () => {
  let db: NodeSqliteDB;
  let existingSettings: Record<string, string>;
  const legacySettings = Object.fromEntries(
    DURABLE_RENDERER_STORAGE_MIGRATIONS.map(([legacy]) => [legacy, '{"saved":123}']),
  );
  const legacyIncidents = JSON.stringify({
    state: {
      incidents: {
        emergency: {
          id: 'emergency',
          protocol: 'meshtastic',
          protocolsSeen: ['meshtastic'],
          severity: 0,
          codes: ['M01'],
          freetext: 'Help',
          senderId: '7',
          senderName: 'Seven',
          channel: 'LongFast',
          receivedAt: 1000,
          lastSeenAt: 2000,
          coordsSource: null,
          messageIds: ['msg'],
          ackCount: 0,
          ackPeerIds: [],
          beaconActive: false,
          beaconAcked: false,
          isDrill: false,
          status: 'open',
          events: [{ at: 1000, kind: 'received', protocol: 'meshtastic' }],
        },
      },
      resolvedTombstones: { resolved: 1500 },
    },
    version: 3,
  });
  const emptyIncidents = { incidents: {}, resolvedTombstones: {} };

  const readSettings = (): Record<string, string> =>
    Object.fromEntries(
      (
        db.prepareOnce('SELECT key, value FROM app_settings').all() as {
          key: string;
          value: string;
        }[]
      ).map(({ key, value }) => [key, value]),
    );

  const expectedEmptySettings = (): Record<string, string> => {
    const keys = DURABLE_RENDERER_STORAGE_KEYS;
    return {
      ...existingSettings,
      [keys.preferences]: JSON.stringify({ legacyAliasesImported: true, values: {} }),
      [keys.chatLastRead.meshtastic]: '{}',
      [keys.chatLastRead.meshcore]: '{}',
      [keys.chatLastRead.reticulum]: '{}',
      [keys.roomsLastRead]: '{}',
      [keys.rrcLastRead]: '{}',
      [keys.mecpBlockedSenders]: JSON.stringify({ state: { blocked: {} }, version: 1 }),
      [keys.takRelayPrefs]: JSON.stringify({
        state: { byIdentity: {}, retiredRooms: null },
        version: 3,
      }),
    };
  };

  beforeEach(() => {
    db = new NodeSqliteDB(':memory:');
    runSchemaUpgrade(db);
    existingSettings = readSettings();
  });

  afterEach(() => {
    db.close();
  });

  it('empties all migrated domains and tombstones while preserving unrelated SQLite settings', () => {
    seedDurableRendererSettings(db, legacySettings);
    seedIncidentsOn(db, legacyIncidents);
    db.prepareOnce('INSERT INTO app_settings(key, value) VALUES (?, ?)').run('locale', 'de');
    db.prepareOnce('INSERT INTO app_settings(key, value) VALUES (?, ?)').run(
      'rendererDeletedStorage:mesh-client:lastConnection:meshcore',
      '1',
    );

    resetDurableRendererData(db);

    expect(readSettings()).toEqual({ ...expectedEmptySettings(), locale: 'de' });
    expect(getIncidentsOn(db)).toEqual(emptyIncidents);
    expect(db.prepareOnce('SELECT id, initialized FROM emergency_incident_storage').all()).toEqual([
      { id: 1, initialized: 1 },
    ]);
  });

  it('prevents preserved exports from resurrecting data after reset and repeated startup retries', () => {
    seedDurableRendererSettings(db, legacySettings);
    seedIncidentsOn(db, legacyIncidents);
    resetDurableRendererData(db);
    resetDurableRendererData(db);
    seedDurableRendererSettings(db, { ...legacySettings, 'mesh-client:lastRead': '{"ch:0":9000}' });

    expect(seedIncidentsOn(db, legacyIncidents)).toEqual(emptyIncidents);
    expect(readSettings()).toEqual(expectedEmptySettings());
  });

  it('records an explicit reset before any legacy import so later caches stay empty', () => {
    resetDurableRendererData(db);
    seedDurableRendererSettings(db, legacySettings);
    expect(seedIncidentsOn(db, legacyIncidents)).toEqual(emptyIncidents);
    expect(readSettings()).toEqual(expectedEmptySettings());
  });

  it('rolls every setting and incident deletion back when the final marker write fails', () => {
    seedDurableRendererSettings(db, legacySettings);
    const incidents = seedIncidentsOn(db, legacyIncidents);
    const settings = readSettings();
    db.execScript(`CREATE TRIGGER fail_reset_marker BEFORE INSERT ON emergency_incident_storage
      BEGIN SELECT RAISE(ABORT, 'simulated reset failure'); END;`);

    expect(() => {
      resetDurableRendererData(db);
    }).toThrow('simulated reset failure');

    expect(readSettings()).toEqual(settings);
    expect(getIncidentsOn(db)).toEqual(incidents);
    expect(db.prepareOnce('SELECT id, initialized FROM emergency_incident_storage').all()).toEqual([
      { id: 1, initialized: 1 },
    ]);
  });

  it.each(['OFF', 'NORMAL', 'FULL', 'EXTRA'])(
    'commits with FULL durability and restores the previous %s synchronous mode',
    (mode) => {
      db.pragma(`synchronous = ${mode}`);
      const previous = db.pragma('synchronous', { simple: true });
      db.execScript(`CREATE TRIGGER require_full_durability BEFORE INSERT ON emergency_incident_storage
        WHEN (SELECT synchronous FROM pragma_synchronous) <> 2
        BEGIN SELECT RAISE(ABORT, 'reset must run with synchronous FULL'); END;`);

      resetDurableRendererData(db);

      expect(readSettings()).toEqual(expectedEmptySettings());
      expect(db.pragma('synchronous', { simple: true })).toBe(previous);
    },
  );

  it.each(['OFF', 'NORMAL', 'FULL', 'EXTRA'])(
    'restores the previous %s synchronous mode after reset rollback',
    (mode) => {
      seedDurableRendererSettings(db, legacySettings);
      const incidents = seedIncidentsOn(db, legacyIncidents);
      const settings = readSettings();
      db.pragma(`synchronous = ${mode}`);
      const previous = db.pragma('synchronous', { simple: true });
      db.execScript(`CREATE TRIGGER fail_durable_reset BEFORE INSERT ON emergency_incident_storage
        BEGIN
          SELECT CASE WHEN (SELECT synchronous FROM pragma_synchronous) <> 2
            THEN RAISE(ABORT, 'reset must run with synchronous FULL') END;
          SELECT RAISE(ABORT, 'simulated durable reset failure');
        END;`);

      expect(() => {
        resetDurableRendererData(db);
      }).toThrow('simulated durable reset failure');

      expect(readSettings()).toEqual(settings);
      expect(getIncidentsOn(db)).toEqual(incidents);
      expect(db.pragma('synchronous', { simple: true })).toBe(previous);
    },
  );
});
