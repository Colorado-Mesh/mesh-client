import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { NodeSqliteDB } from '../db-compat';
import { runSchemaUpgrade } from '../db-schema-sync';
import {
  persistMeshcomMessage,
  pruneMeshcomContactsByCountOn,
  pruneMeshcomMessagesByCountOn,
  rebindMeshcomIdentityOn,
  validateDeleteMeshcomContact,
  validateSaveMeshcomContact,
  validateSaveMeshcomMessage,
} from './meshcom-db-handlers';

describe('validateSaveMeshcomMessage', () => {
  it('accepts a minimal valid message', () => {
    expect(() => {
      validateSaveMeshcomMessage({
        text: 'hello',
        timestamp: Date.now(),
      });
    }).not.toThrow();
  });

  it('rejects missing text', () => {
    expect(() => {
      validateSaveMeshcomMessage({ timestamp: 1 });
    }).toThrow(/text/);
  });

  it('rejects invalid received_via', () => {
    expect(() => {
      validateSaveMeshcomMessage({
        text: 'x',
        timestamp: 1,
        received_via: 'carrier-pigeon',
      });
    }).toThrow(/received_via/);
  });

  it('accepts received_via network (gateway)', () => {
    expect(() => {
      validateSaveMeshcomMessage({
        text: 'x',
        timestamp: 1,
        received_via: 'network',
      });
    }).not.toThrow();
  });

  it('accepts GRC group channel_idx above 255 (e.g. SP 260)', () => {
    expect(() => {
      validateSaveMeshcomMessage({
        text: 'siema',
        timestamp: 1,
        channel_idx: 260,
      });
    }).not.toThrow();
    expect(() => {
      validateSaveMeshcomMessage({
        text: 'siema',
        timestamp: 1,
        channel_idx: 99999,
      });
    }).not.toThrow();
  });

  it('rejects channel_idx outside -1..99999', () => {
    expect(() => {
      validateSaveMeshcomMessage({
        text: 'x',
        timestamp: 1,
        channel_idx: 100000,
      });
    }).toThrow(/channel_idx/);
    expect(() => {
      validateSaveMeshcomMessage({
        text: 'x',
        timestamp: 1,
        channel_idx: 1.5,
      });
    }).toThrow(/channel_idx/);
  });
});

describe('validateSaveMeshcomContact', () => {
  it('accepts a callsign + node_id', () => {
    expect(() => {
      validateSaveMeshcomContact({
        callsign: 'OE1KFR-1',
        node_id: 1,
      });
    }).not.toThrow();
  });

  it('rejects empty callsign', () => {
    expect(() => {
      validateSaveMeshcomContact({ callsign: '  ', node_id: 1 });
    }).toThrow(/callsign/);
  });

  it('accepts explicit favorited 0/1', () => {
    expect(() => {
      validateSaveMeshcomContact({ callsign: 'OE1ABC-1', node_id: 2, favorited: 1 });
    }).not.toThrow();
    expect(() => {
      validateSaveMeshcomContact({ callsign: 'OE1ABC-1', node_id: 2, favorited: false });
    }).not.toThrow();
  });
});

describe('saveMeshcomContact favorited upsert SQL', () => {
  it('preserves existing favorited when the field is omitted on ingest upsert', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'meshcom-db-handlers.ts'),
      'utf8',
    );
    expect(src).toMatch(/WHEN @favorited_provided = 1 THEN excluded\.favorited/);
    expect(src).toMatch(/ELSE meshcom_contacts\.favorited/);
  });
});

describe('validateDeleteMeshcomContact', () => {
  it('uppercases callsign and trims identity (same as saveMeshcomContact)', () => {
    expect(validateDeleteMeshcomContact('  offline-meshcom  ', 'oe1kfr-1')).toEqual({
      identityId: 'offline-meshcom',
      callsign: 'OE1KFR-1',
    });
  });

  it('rejects empty identity or callsign', () => {
    expect(() => {
      validateDeleteMeshcomContact('', 'W1AW-1');
    }).toThrow(/identityId/);
    expect(() => {
      validateDeleteMeshcomContact('id', '  ');
    }).toThrow(/callsign/);
  });
});

describe('deleteMeshcomContact SQL', () => {
  it('deletes by identity_id and callsign PK', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'meshcom-db-handlers.ts'),
      'utf8',
    );
    expect(src).toMatch(/DELETE FROM meshcom_contacts WHERE identity_id = \? AND callsign = \?/);
  });
});

describe('pruneMeshcomMessagesByCountOn', () => {
  it('keeps only the newest N rows', () => {
    const run = vi.fn().mockReturnValue({ changes: 7 });
    const prepareOnce = vi.fn().mockReturnValue({ run });
    const db = { prepareOnce } as never;
    expect(pruneMeshcomMessagesByCountOn(db, 4000)).toBe(7);
    expect(prepareOnce).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM meshcom_messages WHERE id NOT IN'),
    );
    expect(run).toHaveBeenCalledWith(4000);
  });
});

describe('pruneMeshcomContactsByCountOn', () => {
  it('no-ops when under the cap', () => {
    const get = vi.fn().mockReturnValue({ cnt: 10 });
    const prepareOnce = vi.fn().mockReturnValue({ get, run: vi.fn() });
    const db = { prepareOnce } as never;
    expect(pruneMeshcomContactsByCountOn(db, 100)).toBe(0);
  });

  it('deletes excess non-favorited contacts when over the cap', () => {
    const get = vi.fn().mockReturnValueOnce({ cnt: 150 }).mockReturnValueOnce({ cnt: 5 });
    const run = vi.fn().mockReturnValue({ changes: 45 });
    const prepareOnce = vi.fn().mockReturnValue({ get, run });
    const db = { prepareOnce } as never;
    expect(pruneMeshcomContactsByCountOn(db, 100)).toBe(45);
    expect(run).toHaveBeenCalledWith(95);
  });
});

describe('persistMeshcomMessage', () => {
  it('updates the same logical message and remints a wrapped wire id', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mesh-mc-save-'));
    try {
      const db = new NodeSqliteDB(path.join(dir, 'test.db'));
      runSchemaUpgrade(db);
      persistMeshcomMessage(db, {
        identity_id: 'offline-meshcom',
        msg_id: '1',
        from_call: 'N0CALL',
        to_call_or_group: '*',
        text: 'outbound',
        channel_idx: 0,
        timestamp: 1_000,
        status: 'acked',
      });
      persistMeshcomMessage(db, {
        identity_id: 'offline-meshcom',
        msg_id: '1',
        from_call: 'N0CALL',
        to_call_or_group: '*',
        text: 'outbound',
        channel_idx: 0,
        timestamp: 1_000,
        status: 'sent',
      });
      persistMeshcomMessage(db, {
        identity_id: 'offline-meshcom',
        msg_id: '1',
        from_call: 'SP2ONG',
        to_call_or_group: '*',
        text: 'inbound',
        channel_idx: 0,
        timestamp: 5_000,
      });
      const rows = db
        .prepareOnce(
          `SELECT msg_id, from_call, text, status, timestamp FROM meshcom_messages
           ORDER BY timestamp`,
        )
        .all() as {
        msg_id: string;
        from_call: string;
        text: string;
        status: string;
        timestamp: number;
      }[];
      expect(rows).toEqual([
        expect.objectContaining({
          msg_id: '1',
          from_call: 'N0CALL',
          text: 'outbound',
          status: 'sent',
          timestamp: 1_000,
        }),
        expect.objectContaining({
          msg_id: '1~5000',
          from_call: 'SP2ONG',
          text: 'inbound',
          timestamp: 5_000,
        }),
      ]);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('rebindMeshcomIdentityOn', () => {
  it('moves messages and contacts from an ephemeral id into offline', () => {
    const run = vi.fn().mockReturnValue({ changes: 2 });
    const prepareOnce = vi.fn().mockReturnValue({ run, all: vi.fn().mockReturnValue([]) });
    const db = { prepareOnce } as never;
    // drop-logical + remint + move messages + merge + drop + move contacts
    expect(rebindMeshcomIdentityOn(db, 'id-old-session', 'offline-meshcom')).toEqual({
      changes: 12,
    });
    expect(prepareOnce).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE meshcom_messages SET identity_id'),
    );
    expect(prepareOnce).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE meshcom_contacts SET identity_id'),
    );
    expect(prepareOnce).toHaveBeenCalledWith(
      expect.stringContaining("msg_id || '-rb' || CAST(id AS TEXT)"),
    );
    expect(run).toHaveBeenCalledWith({ fromId: 'id-old-session', toId: 'offline-meshcom' });
  });

  it('no-ops when fromId equals toId', () => {
    const prepareOnce = vi.fn();
    const db = { prepareOnce } as never;
    expect(rebindMeshcomIdentityOn(db, 'offline-meshcom', 'offline-meshcom')).toEqual({
      changes: 0,
    });
    expect(prepareOnce).not.toHaveBeenCalled();
  });

  it('consolidates every non-toId bucket when fromId is *', () => {
    const all = vi.fn().mockReturnValue([{ id: 'id-a' }, { id: '' }, { id: 'id-b' }]);
    const run = vi.fn().mockReturnValue({ changes: 1 });
    const prepareOnce = vi.fn().mockReturnValue({ run, all });
    const db = { prepareOnce } as never;
    expect(rebindMeshcomIdentityOn(db, '*', 'offline-meshcom').changes).toBeGreaterThan(0);
    expect(all).toHaveBeenCalledWith('offline-meshcom', 'offline-meshcom');
    expect(run).toHaveBeenCalledWith({ fromId: 'id-a', toId: 'offline-meshcom' });
    expect(run).toHaveBeenCalledWith({ fromId: '', toId: 'offline-meshcom' });
    expect(run).toHaveBeenCalledWith({ fromId: 'id-b', toId: 'offline-meshcom' });
  });
});

describe('rebindMeshcomIdentityOn with NodeSqliteDB', () => {
  it('keeps distinct msg_id collisions and drops only logical duplicates', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mesh-mc-rebind-'));
    try {
      const db = new NodeSqliteDB(path.join(dir, 'test.db'));
      runSchemaUpgrade(db);
      const insert = db.prepareOnce(
        `INSERT INTO meshcom_messages
           (identity_id, msg_id, from_call, text, channel_idx, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      // Same logical message under both identities — source should be dropped.
      insert.run('offline-meshcom', 'shared', 'N0CALL', 'same body', 0, 1000);
      insert.run('id-old', 'shared', 'N0CALL', 'same body', 0, 1000);
      // msg_id collision with different body — both must survive (source reminted).
      insert.run('offline-meshcom', 'collide', 'N0CALL', 'offline text', 0, 2000);
      insert.run('id-old', 'collide', 'N0PEER', 'orphan text', 312, 2001);
      // Source-only id — moves unchanged.
      insert.run('id-old', 'only-src', 'N0CALL', 'orphan only', 0, 3000);
      // Null msg_id under source — moves; unrelated identity untouched.
      insert.run('id-old', null, 'N0CALL', 'null id', 0, 4000);
      insert.run('id-unrelated', 'shared', 'N0OTHER', 'leave me', 0, 5000);

      rebindMeshcomIdentityOn(db, 'id-old', 'offline-meshcom');

      const rows = db
        .prepareOnce(
          `SELECT identity_id, msg_id, from_call, text, channel_idx, timestamp
           FROM meshcom_messages ORDER BY timestamp, id`,
        )
        .all() as {
        identity_id: string;
        msg_id: string | null;
        from_call: string | null;
        text: string;
        channel_idx: number;
        timestamp: number;
      }[];

      expect(rows.filter((r) => r.identity_id === 'id-old')).toEqual([]);
      expect(rows.filter((r) => r.identity_id === 'id-unrelated')).toEqual([
        expect.objectContaining({
          msg_id: 'shared',
          text: 'leave me',
          from_call: 'N0OTHER',
        }),
      ]);
      const offline = rows.filter((r) => r.identity_id === 'offline-meshcom');
      expect(offline).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            msg_id: 'shared',
            text: 'same body',
            from_call: 'N0CALL',
            timestamp: 1000,
          }),
          expect.objectContaining({
            msg_id: 'collide',
            text: 'offline text',
            from_call: 'N0CALL',
          }),
          expect.objectContaining({
            msg_id: expect.stringMatching(/^collide-rb\d+$/),
            text: 'orphan text',
            from_call: 'N0PEER',
            channel_idx: 312,
          }),
          expect.objectContaining({
            msg_id: 'only-src',
            text: 'orphan only',
          }),
          expect.objectContaining({
            msg_id: null,
            text: 'null id',
          }),
        ]),
      );
      // Logical duplicate was not double-inserted.
      expect(offline.filter((r) => r.msg_id === 'shared' && r.text === 'same body')).toHaveLength(
        1,
      );
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it('merges source favorite and coords into destination before dropping the contact', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mesh-mc-rebind-contact-'));
    try {
      const db = new NodeSqliteDB(path.join(dir, 'test.db'));
      runSchemaUpgrade(db);
      db.prepareOnce(
        `INSERT INTO meshcom_contacts
           (callsign, identity_id, node_id, lat, lon, batt, last_heard, favorited)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('N0CALL', 'offline-meshcom', 1, null, null, null, 100, 0);
      db.prepareOnce(
        `INSERT INTO meshcom_contacts
           (callsign, identity_id, node_id, lat, lon, batt, last_heard, favorited)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('N0CALL', 'id-old', 1, 39.7, -105.0, 88, 200, 1);

      rebindMeshcomIdentityOn(db, 'id-old', 'offline-meshcom');

      const row = db
        .prepareOnce(
          `SELECT identity_id, favorited, lat, lon, batt, last_heard
           FROM meshcom_contacts WHERE callsign = 'N0CALL'`,
        )
        .get() as {
        identity_id: string;
        favorited: number;
        lat: number | null;
        lon: number | null;
        batt: number | null;
        last_heard: number | null;
      };
      expect(row.identity_id).toBe('offline-meshcom');
      expect(row.favorited).toBe(1);
      expect(row.lat).toBe(39.7);
      expect(row.lon).toBe(-105.0);
      expect(row.batt).toBe(88);
      expect(row.last_heard).toBe(200);
      expect(
        (
          db
            .prepareOnce(`SELECT COUNT(*) AS c FROM meshcom_contacts WHERE callsign = 'N0CALL'`)
            .get() as { c: number }
        ).c,
      ).toBe(1);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it('does not treat same msg_id with different recipients as logical duplicates', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mesh-mc-rebind-to-'));
    try {
      const db = new NodeSqliteDB(path.join(dir, 'test.db'));
      runSchemaUpgrade(db);
      const insert = db.prepareOnce(
        `INSERT INTO meshcom_messages
           (identity_id, msg_id, from_call, to_call_or_group, text, channel_idx, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      insert.run('offline-meshcom', 'm1', 'N0CALL', 'W1AW', 'hi', -1, 1000);
      insert.run('id-old', 'm1', 'N0CALL', 'K1ABC', 'hi', -1, 1000);
      rebindMeshcomIdentityOn(db, 'id-old', 'offline-meshcom');
      const rows = db
        .prepareOnce(
          `SELECT msg_id, to_call_or_group FROM meshcom_messages
           WHERE identity_id = 'offline-meshcom' ORDER BY id`,
        )
        .all() as { msg_id: string; to_call_or_group: string }[];
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.to_call_or_group).sort()).toEqual(['K1ABC', 'W1AW']);
      expect(rows.some((r) => r.msg_id === 'm1')).toBe(true);
      expect(rows.some((r) => /^m1-rb\d+$/.test(r.msg_id))).toBe(true);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
