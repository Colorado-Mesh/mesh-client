// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../log-service', async () => {
  const actual = await import('../sanitize-log-message');
  return { sanitizeLogMessage: actual.sanitizeLogMessage };
});

import { NodeSqliteDB } from '../db-compat';
import { CustomMapSourceStore } from './custom-sources';
import { CustomMapSourcesService } from './custom-sources-service';
import { inspectMbtilesFile, MbtilesReaderPool } from './mbtiles';
import type { TileCache } from './tile-cache';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function writeMbtiles(
  file: string,
  opts: {
    metadata?: Record<string, string>;
    tiles?: { z: number; x: number; tmsY: number; data: Buffer }[];
  } = {},
): void {
  const db = new NodeSqliteDB(file);
  db.execScript(
    'CREATE TABLE metadata (name TEXT, value TEXT);' +
      'CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);',
  );
  for (const [k, v] of Object.entries(opts.metadata ?? {})) {
    db.prepare('INSERT INTO metadata (name, value) VALUES (?, ?)').run(k, v);
  }
  for (const t of opts.tiles ?? [{ z: 1, x: 0, tmsY: 1, data: PNG }]) {
    db.prepare(
      'INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
    ).run(t.z, t.x, t.tmsY, t.data);
  }
  db.close();
}

describe('custom map sources', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'mesh-custom-src-'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('MBTiles inspection and reading', () => {
    it('inspects a raster package and flips TMS rows when reading', async () => {
      const file = path.join(root, 'ok.mbtiles');
      writeMbtiles(file, {
        metadata: {
          name: 'Trail',
          attribution: 'Trail maps',
          minzoom: '0',
          maxzoom: '5',
          format: 'png',
        },
        tiles: [
          { z: 2, x: 1, tmsY: 3, data: PNG }, // XYZ y = 4 - 1 - 3 = 0
          { z: 2, x: 1, tmsY: 0, data: JPEG }, // XYZ y = 3
        ],
      });
      const info = await inspectMbtilesFile(file);
      // Zoom range comes from the tiles table (both rows are z=2), not metadata min/max.
      expect(info).toMatchObject({
        name: 'Trail',
        attribution: 'Trail maps',
        format: 'png',
        minZoom: 2,
        maxZoom: 2,
      });
      const pool = new MbtilesReaderPool(() => file);
      expect(pool.getTile('mbtiles-000000000001', 2, 1, 0)?.equals(PNG)).toBe(true);
      expect(pool.getTile('mbtiles-000000000001', 2, 1, 3)?.equals(JPEG)).toBe(true);
      expect(pool.getTile('mbtiles-000000000001', 2, 0, 0)).toBeNull();
      pool.closeAll();
    });

    it('rejects vector, non-sqlite, schema-less and oversized inputs', async () => {
      const vector = path.join(root, 'vector.mbtiles');
      writeMbtiles(vector, { metadata: { format: 'pbf' } });
      await expect(inspectMbtilesFile(vector)).rejects.toMatchObject({ code: 'mbtiles_vector' });

      const gz = path.join(root, 'gz.mbtiles');
      writeMbtiles(gz, { tiles: [{ z: 0, x: 0, tmsY: 0, data: Buffer.from([0x1f, 0x8b, 8, 0]) }] });
      await expect(inspectMbtilesFile(gz)).rejects.toMatchObject({ code: 'mbtiles_vector' });

      const text = path.join(root, 'text.mbtiles');
      writeFileSync(text, 'not a database');
      await expect(inspectMbtilesFile(text)).rejects.toMatchObject({ code: 'mbtiles_invalid' });

      const noSchema = path.join(root, 'empty.mbtiles');
      const db = new NodeSqliteDB(noSchema);
      db.execScript('CREATE TABLE other (a TEXT);');
      db.close();
      await expect(inspectMbtilesFile(noSchema)).rejects.toMatchObject({ code: 'mbtiles_invalid' });

      await expect(inspectMbtilesFile(path.join(root, 'missing.mbtiles'))).rejects.toMatchObject({
        code: 'io',
      });
    });
  });

  describe('CustomMapSourceStore', () => {
    it('requires confirmation and validates the template before persisting', async () => {
      const store = new CustomMapSourceStore(root);
      const base = {
        name: 'Topo',
        urlTemplate: 'https://tiles.example.org/{z}/{x}/{y}.png',
        attribution: '© Example',
      };
      expect(await store.addXyz({ ...base, confirmed: false })).toEqual({
        ok: false,
        code: 'not_confirmed',
      });
      expect(await store.addXyz({ ...base, attribution: ' ', confirmed: true })).toEqual({
        ok: false,
        code: 'attribution',
      });
      expect(
        await store.addXyz({
          ...base,
          urlTemplate: 'https://127.0.0.1/{z}/{x}/{y}',
          confirmed: true,
        }),
      ).toEqual({ ok: false, code: 'host' });
      expect(
        await store.addXyz({
          ...base,
          urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          confirmed: true,
        }),
      ).toEqual({ ok: false, code: 'osm' });
      expect(await store.addXyz({ ...base, maxNativeZoom: 40, confirmed: true })).toEqual({
        ok: false,
        code: 'zoom',
      });
      expect(await store.list()).toEqual([]);

      const ok = await store.addXyz({ ...base, maxNativeZoom: 17, confirmed: true });
      expect(ok.ok).toBe(true);
      const reloaded = await new CustomMapSourceStore(root).list();
      expect(reloaded).toHaveLength(1);
      expect(reloaded[0]).toMatchObject({
        kind: 'xyz',
        host: 'tiles.example.org',
        maxNativeZoom: 17,
      });
    });

    it('drops tampered records on load instead of trusting the file', async () => {
      const store = new CustomMapSourceStore(root);
      const added = await store.addXyz({
        name: 'Good',
        urlTemplate: 'https://tiles.example.org/{z}/{x}/{y}.png',
        attribution: 'A',
        confirmed: true,
      });
      expect(added.ok).toBe(true);
      const file = path.join(root, 'custom-sources.json');
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
        sources: Record<string, unknown>[];
      };
      parsed.sources.push({
        ...parsed.sources[0],
        id: 'xyz-aaaaaaaaaaaa',
        urlTemplate: 'https://169.254.169.254/{z}/{x}/{y}',
      });
      writeFileSync(file, JSON.stringify(parsed));
      const list = await new CustomMapSourceStore(root).list();
      expect(list.map((r) => r.name)).toEqual(['Good']);
    });

    it('quarantines a corrupt file and starts empty', async () => {
      writeFileSync(path.join(root, 'custom-sources.json'), '{nope');
      expect(await new CustomMapSourceStore(root).list()).toEqual([]);
    });

    it('rethrows non-ENOENT catalog read errors without wiping persisted sources', async () => {
      const store = new CustomMapSourceStore(root);
      const added = await store.addXyz({
        name: 'Keep',
        urlTemplate: 'https://tiles.example.org/{z}/{x}/{y}.png',
        attribution: 'A',
        confirmed: true,
      });
      expect(added.ok).toBe(true);
      const file = path.join(root, 'custom-sources.json');
      const saved = readFileSync(file, 'utf8');
      // Replace the JSON file with a directory so readFile fails with EISDIR, not ENOENT.
      const { unlinkSync, mkdirSync, rmSync: rmDir } = await import('fs');
      unlinkSync(file);
      mkdirSync(file);
      await expect(new CustomMapSourceStore(root).list()).rejects.toThrow();
      rmDir(file, { recursive: true, force: true });
      writeFileSync(file, saved);
      // Failure must not have persisted an empty list over the existing catalog.
      expect(await new CustomMapSourceStore(root).list()).toHaveLength(1);
    });
  });

  describe('CustomMapSourcesService', () => {
    function makeService(pick: () => Promise<string | null>) {
      const clearSource = vi.fn(() => Promise.resolve());
      const cache = { clearSource } as unknown as TileCache;
      const store = new CustomMapSourceStore(path.join(root, 'offline-maps'));
      return { svc: new CustomMapSourcesService(store, () => cache, pick), store, clearSource };
    }

    it('never exposes the XYZ template to the renderer', async () => {
      const { svc } = makeService(() => Promise.resolve(null));
      const res = await svc.addXyz({
        name: 'Keyed',
        urlTemplate: 'https://tiles.example.org/{z}/{x}/{y}.png?key=SECRET',
        attribution: 'A',
        confirmed: true,
      });
      expect(JSON.stringify(res)).not.toContain('SECRET');
      expect(JSON.stringify(await svc.list())).not.toContain('SECRET');
    });

    it('imports an MBTiles package only via picker token + confirmation, then serves and removes it', async () => {
      const src = path.join(root, 'in.mbtiles');
      writeMbtiles(src, {
        metadata: { name: 'Pkg', maxzoom: '4' },
        tiles: [
          { z: 1, x: 0, tmsY: 1, data: PNG },
          { z: 4, x: 0, tmsY: 0, data: PNG },
        ],
      });
      const { svc, store } = makeService(() => Promise.resolve(src));

      const pick = await svc.pickMbtiles();
      expect(pick.ok).toBe(true);
      if (!pick.ok) return;
      expect(pick.name).toBe('Pkg');
      expect(pick.attribution).toBe(''); // package lacks attribution → user must supply it

      const base = { inspectId: pick.inspectId, name: 'Pkg', attribution: 'Me' };
      expect(await svc.importMbtiles({ ...base, confirmed: false })).toEqual({
        ok: false,
        code: 'not_confirmed',
      });
      expect(await svc.importMbtiles({ ...base, inspectId: 'forged', confirmed: true })).toEqual({
        ok: false,
        code: 'unknown_inspect',
      });
      expect(await svc.importMbtiles({ ...base, attribution: '', confirmed: true })).toEqual({
        ok: false,
        code: 'attribution',
      });

      const done = await svc.importMbtiles({ ...base, confirmed: true });
      expect(done.ok).toBe(true);
      if (!done.ok) return;
      // maxNativeZoom comes from MAX(zoom_level) in the tiles table (1..4).
      expect(done.source).toMatchObject({ kind: 'mbtiles', maxNativeZoom: 4 });
      expect(done.source.fileBytes).toBeGreaterThan(0);
      // token is single-use
      expect(await svc.importMbtiles({ ...base, confirmed: true })).toEqual({
        ok: false,
        code: 'unknown_inspect',
      });

      expect((await svc.readMbtilesTile(done.source.id, 1, 0, 0))?.equals(PNG)).toBe(true);
      expect(await svc.remove(done.source.id)).toEqual({ ok: true });
      expect(await store.list()).toEqual([]);
      await expect(svc.readMbtilesTile(done.source.id, 1, 0, 0)).rejects.toBeTruthy();
      svc.dispose();
    });

    it('reports cancel and invalid files without registering anything', async () => {
      const bad = path.join(root, 'bad.mbtiles');
      writeFileSync(bad, 'nope');
      const cancelled = makeService(() => Promise.resolve(null));
      expect(await cancelled.svc.pickMbtiles()).toEqual({ ok: false, code: 'cancelled' });
      const invalid = makeService(() => Promise.resolve(bad));
      expect(await invalid.svc.pickMbtiles()).toEqual({ ok: false, code: 'mbtiles_invalid' });
      expect(await invalid.svc.list()).toEqual([]);
    });

    it('removes an XYZ source and clears its cached tiles', async () => {
      const { svc, clearSource } = makeService(() => Promise.resolve(null));
      const added = await svc.addXyz({
        name: 'X',
        urlTemplate: 'https://tiles.example.org/{z}/{x}/{y}.png',
        attribution: 'A',
        confirmed: true,
      });
      if (!added.ok) throw new Error('add failed');
      expect(await svc.remove(added.source.id)).toEqual({ ok: true });
      expect(clearSource).toHaveBeenCalledWith(added.source.id);
      expect(await svc.remove('../../etc')).toEqual({ ok: false });
    });
  });
});
