// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DURABLE_RENDERER_SETTING_MAX_LENGTH,
  DURABLE_RENDERER_STORAGE_MIGRATIONS,
} from '../shared/rendererOrigin';
import { NodeSqliteDB } from './db-compat';
import { seedDurableRendererSettings } from './durableRendererSettings';

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
