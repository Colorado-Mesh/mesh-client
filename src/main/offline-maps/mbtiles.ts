import fs from 'fs/promises';

import {
  isValidCustomMaxNativeZoom,
  MBTILES_MAX_BYTES,
  sniffRasterTileMime,
} from '@/shared/offlineMaps/customMapSources';

import { NodeSqliteDB } from '../db-compat';

const SQLITE_MAGIC = Buffer.from('SQLite format 3\u0000', 'latin1');

export type MbtilesErrorCode = 'mbtiles_invalid' | 'mbtiles_vector' | 'mbtiles_too_large' | 'io';

export class MbtilesError extends Error {
  constructor(
    readonly code: MbtilesErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MbtilesError';
  }
}

export interface MbtilesInspection {
  name: string | null;
  attribution: string | null;
  format: 'png' | 'jpg' | 'webp';
  minZoom: number;
  maxZoom: number;
  fileBytes: number;
}

function metaValue(db: NodeSqliteDB, key: string): string | null {
  const row = db.prepare('SELECT value FROM metadata WHERE name = ?').get(key) as
    { value?: unknown } | undefined;
  return typeof row?.value === 'string' && row.value.trim() ? row.value.trim() : null;
}

function parseZoom(raw: string | null): number | null {
  if (raw == null || !/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  return isValidCustomMaxNativeZoom(n) ? n : null;
}

function formatFromMime(mime: string): 'png' | 'jpg' | 'webp' {
  if (mime === 'image/jpeg') return 'jpg';
  return mime === 'image/webp' ? 'webp' : 'png';
}

/**
 * Validate an MBTiles file without trusting its contents: SQLite header + size cap, read-only open,
 * required `tiles` / `metadata` tables, raster-only (vector `pbf` is rejected), and a real tile
 * whose magic bytes are PNG/JPEG/WebP.
 */
export async function inspectMbtilesFile(filePath: string): Promise<MbtilesInspection> {
  let fileBytes: number;
  try {
    const st = await fs.stat(filePath);
    if (!st.isFile()) throw new MbtilesError('mbtiles_invalid', 'Not a file');
    fileBytes = st.size;
  } catch (e: unknown) {
    if (e instanceof MbtilesError) throw e;
    throw new MbtilesError('io', 'Cannot read file');
  }
  if (fileBytes > MBTILES_MAX_BYTES) {
    throw new MbtilesError('mbtiles_too_large', 'File exceeds MBTiles import limit');
  }
  const handle = await fs.open(filePath, 'r').catch(() => null);
  if (!handle) throw new MbtilesError('io', 'Cannot open file');
  try {
    const head = Buffer.alloc(SQLITE_MAGIC.length);
    await handle.read(head, 0, head.length, 0);
    if (!head.equals(SQLITE_MAGIC)) {
      throw new MbtilesError('mbtiles_invalid', 'Not a SQLite database');
    }
  } finally {
    await handle.close();
  }

  let db: NodeSqliteDB | null = null;
  try {
    db = new NodeSqliteDB(filePath, { readonly: true });
    const tables = new Set(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all() as {
          name: string;
        }[]
      ).map((r) => r.name),
    );
    if (!tables.has('tiles') || !tables.has('metadata')) {
      throw new MbtilesError('mbtiles_invalid', 'Missing tiles/metadata table');
    }
    const declared = metaValue(db, 'format')?.toLowerCase() ?? null;
    if (declared === 'pbf' || declared === 'mvt') {
      throw new MbtilesError('mbtiles_vector', 'Vector MBTiles are not supported');
    }
    const sample = db.prepare('SELECT tile_data FROM tiles LIMIT 1').get() as
      { tile_data?: unknown } | undefined;
    if (!(sample?.tile_data instanceof Uint8Array)) {
      throw new MbtilesError('mbtiles_invalid', 'No tiles');
    }
    const mime = sniffRasterTileMime(sample.tile_data);
    if (!mime) throw new MbtilesError('mbtiles_vector', 'Tiles are not PNG/JPEG/WebP');
    const minZoom = parseZoom(metaValue(db, 'minzoom')) ?? 0;
    const maxZoom = parseZoom(metaValue(db, 'maxzoom')) ?? 18;
    return {
      name: metaValue(db, 'name'),
      attribution: metaValue(db, 'attribution'),
      format: formatFromMime(mime),
      minZoom: Math.min(minZoom, maxZoom),
      maxZoom: Math.max(minZoom, maxZoom),
      fileBytes,
    };
  } catch (e: unknown) {
    if (e instanceof MbtilesError) throw e;
    // Corrupt / unreadable SQLite → invalid package (message not surfaced; may contain paths).
    throw new MbtilesError('mbtiles_invalid', 'Unreadable MBTiles database');
  } finally {
    try {
      db?.close();
    } catch {
      // catch-no-log-ok best-effort close of read-only handle
    }
  }
}

/** Keeps one read-only handle per imported package; MBTiles stores rows in TMS order (y flipped). */
export class MbtilesReaderPool {
  private readonly handles = new Map<string, NodeSqliteDB>();

  constructor(private readonly resolvePath: (id: string) => string) {}

  getTile(id: string, z: number, x: number, y: number): Buffer | null {
    let db = this.handles.get(id);
    if (!db) {
      db = new NodeSqliteDB(this.resolvePath(id), { readonly: true });
      this.handles.set(id, db);
    }
    const tmsRow = 2 ** z - 1 - y;
    const row = db
      .prepareOnce(
        'SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?',
      )
      .get(z, x, tmsRow) as { tile_data?: unknown } | undefined;
    return row?.tile_data instanceof Uint8Array ? Buffer.from(row.tile_data) : null;
  }

  close(id: string): void {
    const db = this.handles.get(id);
    if (!db) return;
    this.handles.delete(id);
    try {
      db.close();
    } catch {
      // catch-no-log-ok best-effort close
    }
  }

  closeAll(): void {
    for (const id of [...this.handles.keys()]) this.close(id);
  }
}
