// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NodeSqliteDB } from './db-compat';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-save-nodes-batch-'));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => tmpDir),
    getVersion: vi.fn(() => '1.0.0'),
    isPackaged: false,
  },
  dialog: {
    showErrorBox: vi.fn(),
    showMessageBoxSync: vi.fn(() => 0),
  },
}));

vi.mock('./fatal-startup-dialog', async () => {
  const actual = await vi.importActual('./fatal-startup-dialog');
  return {
    ...(actual as object),
    confirmDatabaseSchemaUpgrade: vi.fn(() => true),
  };
});

describe('saveNodesBatch (disk-backed)', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const file of fs.readdirSync(tmpDir)) {
      fs.rmSync(path.join(tmpDir, file), { force: true, recursive: true });
    }
  });

  afterEach(async () => {
    try {
      const { closeDatabase } = await import('./database');
      closeDatabase();
    } catch {
      // catch-no-log-ok module may not have finished opening
    }
    vi.resetModules();
  });

  it('writes 1000 rows in one transaction and preserves single-row merge parity', async () => {
    const { initDatabase, getDatabase, saveNodeRow, saveNodesBatch, toNodeUpsertParams } =
      await import('./database');
    initDatabase();
    const db = getDatabase();

    const batch = Array.from({ length: 1000 }, (_, i) =>
      toNodeUpsertParams({
        node_id: i + 1,
        long_name: `Node ${i + 1}`,
        short_name: `N${i + 1}`,
        hw_model: 'TBeam',
        snr: 1,
        battery: 90,
        last_heard: 1_700_000_000 + i,
        latitude: null,
        longitude: null,
        hops_away: 2,
        source: 'rf',
      }),
    );
    const result = saveNodesBatch(batch);
    expect(result.saved).toBe(1000);
    expect(result.dropped).toBe(0);

    const count = db.prepareOnce('SELECT COUNT(*) AS c FROM nodes').get() as { c: number };
    expect(count.c).toBe(1000);

    // Single-row path uses the same SQL/params — merge hops_away min.
    saveNodeRow(
      toNodeUpsertParams({
        node_id: 1,
        long_name: 'Node 1',
        short_name: 'N1',
        hw_model: 'TBeam',
        snr: 2,
        battery: 90,
        last_heard: 1_700_000_100,
        hops_away: 1,
        source: 'rf',
      }),
    );
    const row = db
      .prepareOnce('SELECT hops_away, snr, long_name FROM nodes WHERE node_id = 1')
      .get() as {
      hops_away: number;
      snr: number;
      long_name: string;
    };
    expect(row.hops_away).toBe(1);
    expect(row.snr).toBe(2);
    expect(row.long_name).toBe('Node 1');
  });

  it('rethrows SQLITE_FULL / SQLITE_IOERR from saveNodesBatchOn so the batch can retry', async () => {
    const { isSqliteOperationalWriteError, saveNodesBatchOn } = await import('./nodeUpsert');
    expect(
      isSqliteOperationalWriteError(
        Object.assign(new Error('database or disk is full'), {
          errcode: 13,
          code: 'ERR_SQLITE_ERROR',
        }),
      ),
    ).toBe(true);
    expect(
      isSqliteOperationalWriteError(
        Object.assign(new Error('disk I/O error'), { errcode: 10, code: 'ERR_SQLITE_ERROR' }),
      ),
    ).toBe(true);
    expect(
      isSqliteOperationalWriteError(
        Object.assign(new Error('NOT NULL constraint failed: nodes.long_name'), {
          errcode: 1299,
          errstr: 'constraint failed',
          code: 'ERR_SQLITE_ERROR',
        }),
      ),
    ).toBe(false);

    const run = vi.fn().mockImplementationOnce(() => {
      throw Object.assign(new Error('database or disk is full'), { errcode: 13 });
    });
    const db = {
      prepareOnce: () => ({ run }),
      transaction: (fn: () => void) => fn,
    } as unknown as NodeSqliteDB;

    expect(() =>
      saveNodesBatchOn(db, [
        {
          node_id: 1,
          long_name: 'A',
          short_name: 'A',
          hw_model: 'T',
          snr: 1,
          rssi: null,
          battery: 1,
          last_heard: 1,
          latitude: null,
          longitude: null,
          role: null,
          hops_away: 1,
          via_mqtt: null,
          voltage: null,
          channel_utilization: null,
          air_util_tx: null,
          altitude: null,
          source: 'rf',
          num_packets_rx_bad: null,
          num_rx_dupe: null,
          num_packets_rx: null,
          num_packets_tx: null,
          hops: null,
          path: null,
          public_key: null,
        },
      ]),
    ).toThrow(/database or disk is full/);
  });
});
