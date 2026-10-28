// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as DatabaseModule from './database';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-radio-snapshot-'));
vi.mock('electron', () => ({
  app: { getPath: () => profile, getVersion: () => '1.0.0', isPackaged: false },
}));
let runtime: typeof DatabaseModule;
const before = '2026-01-01T00:00:00.000Z';
const cutoff = '2026-01-01T00:00:01.000Z';
const after = '2026-01-01T00:00:02.000Z';
const row = (id: number, synced = before): DatabaseModule.MeshcoreContactUpsertParams => ({
  node_id: id,
  public_key: id.toString(16).padStart(64, '0'),
  adv_name: `Room ${id}`,
  contact_type: 3,
  last_advert: 0,
  adv_lat: 0,
  adv_lon: 0,
  last_snr: null,
  last_rssi: null,
  nickname: 'Local nickname',
  contact_flags: 0,
  hops_away: null,
  on_radio: 1,
  last_synced_from_radio: synced,
});
const flags = () =>
  runtime
    .getDatabase()
    .prepareOnce(
      'SELECT node_id, on_radio, nickname, favorited FROM meshcore_contacts ORDER BY node_id',
    )
    .all();

beforeEach(async () => {
  vi.resetModules();
  runtime = await import('./database');
  runtime.initDatabase();
});
afterEach(() => {
  runtime.closeDatabase();
  for (const file of fs.readdirSync(profile))
    fs.rmSync(path.join(profile, file), { recursive: true, force: true });
});
afterAll(() => {
  fs.rmSync(profile, { recursive: true, force: true });
});

describe('atomic radio contact snapshots', () => {
  it('clears absent radio flags, preserves local records and keeps newer live contacts', () => {
    runtime.saveMeshcoreContactsBatch([row(1), row(2), row(3, after), row(4, cutoff)]);
    runtime
      .getDatabase()
      .prepareOnce('UPDATE meshcore_contacts SET favorited = 1 WHERE node_id = 2')
      .run();
    runtime.saveMeshcoreContactsBatch([row(1, after)], cutoff);
    expect(flags()).toEqual([
      { node_id: 1, on_radio: 1, nickname: 'Local nickname', favorited: 0 },
      { node_id: 2, on_radio: 0, nickname: 'Local nickname', favorited: 1 },
      { node_id: 3, on_radio: 1, nickname: 'Local nickname', favorited: 0 },
      { node_id: 4, on_radio: 1, nickname: 'Local nickname', favorited: 0 },
    ]);
  });
  it('stamps the null timestamp produced by live contact IPC and protects it during a dump', () => {
    runtime.saveMeshcoreContactsBatch([row(1)]);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(after));
      runtime.saveMeshcoreContactsBatch([{ ...row(2), last_synced_from_radio: null }]);
      runtime.saveMeshcoreContactsBatch([], cutoff);
      expect(flags()).toEqual([
        { node_id: 1, on_radio: 0, nickname: 'Local nickname', favorited: 0 },
        { node_id: 2, on_radio: 1, nickname: 'Local nickname', favorited: 0 },
      ]);
      expect(
        runtime
          .getDatabase()
          .prepareOnce(
            'SELECT last_synced_from_radio AS stamp FROM meshcore_contacts WHERE node_id = 2',
          )
          .get(),
      ).toEqual({ stamp: after });
    } finally {
      vi.useRealTimers();
    }
  });
  it('handles an empty complete snapshot without deleting local history', () => {
    runtime.saveMeshcoreContactsBatch([row(1)]);
    expect(runtime.saveMeshcoreContactsBatch([], cutoff)).toBe(0);
    expect(flags()).toEqual([
      { node_id: 1, on_radio: 0, nickname: 'Local nickname', favorited: 0 },
    ]);
  });
  it('rolls back old flags and new records together when an upsert fails', () => {
    runtime.saveMeshcoreContactsBatch([row(1)]);
    runtime
      .getDatabase()
      .execScript(
        "CREATE TRIGGER reject_contact BEFORE INSERT ON meshcore_contacts WHEN NEW.node_id = 3 BEGIN SELECT RAISE(ABORT, 'disk failure'); END",
      );
    expect(() => runtime.saveMeshcoreContactsBatch([row(2), row(3)], cutoff)).toThrow(
      'disk failure',
    );
    expect(flags()).toEqual([
      { node_id: 1, on_radio: 1, nickname: 'Local nickname', favorited: 0 },
    ]);
  });
});
