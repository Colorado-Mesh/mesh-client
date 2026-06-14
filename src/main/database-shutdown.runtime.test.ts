// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-db-test-'));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => tmpDir),
    getVersion: vi.fn(() => '1.0.0'),
    isPackaged: false,
  },
}));

describe('database shutdown runtime', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const file of fs.readdirSync(tmpDir)) {
      fs.rmSync(path.join(tmpDir, file), { force: true, recursive: true });
    }
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('getDatabaseIfOpen returns null after closeDatabase', async () => {
    const { closeDatabase, DATABASE_CLOSED_MESSAGE, getDatabase, getDatabaseIfOpen, initDatabase } =
      await import('./database');

    initDatabase();
    expect(getDatabaseIfOpen()).not.toBeNull();
    closeDatabase();
    expect(getDatabaseIfOpen()).toBeNull();
    expect(() => getDatabase()).toThrow(DATABASE_CLOSED_MESSAGE);
  });
});
