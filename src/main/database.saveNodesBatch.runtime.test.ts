// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
});
