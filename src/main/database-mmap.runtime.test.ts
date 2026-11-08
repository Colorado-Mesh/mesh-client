// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-db-mmap-'));

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

describe('initDatabase mmap_size (disk-backed)', () => {
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

  it('sets mmap_size and supports reads/writes on a disk database', async () => {
    const { initDatabase, getDatabase } = await import('./database');
    initDatabase();
    const db = getDatabase();

    const mmap = Number(db.pragma('mmap_size', { simple: true }));
    // Supported builds honor the 256 MiB request; unsupported builds may report 0.
    expect(Number.isFinite(mmap)).toBe(true);
    if (mmap > 0) {
      expect(mmap).toBeGreaterThanOrEqual(268435456);
    }

    db.prepareOnce(
      `INSERT INTO nodes (node_id, long_name, short_name, hw_model, battery, snr, last_heard, favorited, source)
       VALUES (1, 'Mmap', 'MM', 'T', 50, 0, 1, 0, 'rf')`,
    ).run();
    const row = db.prepareOnce('SELECT long_name FROM nodes WHERE node_id = 1').get() as {
      long_name: string;
    };
    expect(row.long_name).toBe('Mmap');
  });
});
