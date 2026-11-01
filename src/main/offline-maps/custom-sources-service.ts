import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import {
  type AddXyzSourceRequest,
  CUSTOM_MAP_SOURCES_MAX,
  type CustomMapSourceInfo,
  type CustomMapSourceResult,
  type ImportMbtilesRequest,
  isCustomMapSourceId,
  type MbtilesPickResult,
  sanitizeCustomSourceAttribution,
  sanitizeCustomSourceName,
} from '@/shared/offlineMaps/customMapSources';
import { MS_PER_MINUTE } from '@/shared/timeConstants';

import { sanitizeLogMessage } from '../log-service';
import type { CustomMapSourceStore } from './custom-sources';
import { toPublicInfo } from './custom-sources';
import { inspectMbtilesFile, MbtilesError, MbtilesReaderPool } from './mbtiles';
import type { CustomTileSources } from './protocol';
import type { TileCache } from './tile-cache';

const PENDING_INSPECT_TTL_MS = 10 * MS_PER_MINUTE;
const PENDING_INSPECT_MAX = 4;

interface PendingInspect {
  filePath: string;
  createdAt: number;
}

/**
 * Orchestrates custom XYZ sources + MBTiles packages: allowlist store, package copy, readers, and
 * cleanup. The renderer never supplies a filesystem path or remote host — MBTiles paths come only
 * from the main-process file dialog (held under a one-time `inspectId`), and XYZ hosts only from
 * templates validated and persisted here after explicit confirmation.
 */
export class CustomMapSourcesService implements CustomTileSources {
  private readonly pool: MbtilesReaderPool;
  private readonly pending = new Map<string, PendingInspect>();

  constructor(
    private readonly store: CustomMapSourceStore,
    private readonly getCache: () => TileCache | null,
    /** Shows the OS open dialog; returns the chosen path or `null` when cancelled. */
    private readonly pickFile: () => Promise<string | null>,
  ) {
    this.pool = new MbtilesReaderPool((id) => this.store.mbtilesPath(id));
  }

  get(id: string): ReturnType<CustomMapSourceStore['get']> {
    return this.store.get(id);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- sync read; async so failures reject
  async readMbtilesTile(id: string, z: number, x: number, y: number): Promise<Buffer | null> {
    return this.pool.getTile(id, z, x, y);
  }

  async list(): Promise<CustomMapSourceInfo[]> {
    return (await this.store.list()).map(toPublicInfo);
  }

  async addXyz(req: AddXyzSourceRequest): Promise<CustomMapSourceResult> {
    const res = await this.store.addXyz(req);
    if (!res.ok) return res;
    // Log host only — never the template (may embed an API key).
    console.debug(
      '[offline-maps] custom XYZ source added:',
      sanitizeLogMessage(res.value.host ?? ''),
    );
    return { ok: true, source: toPublicInfo(res.value) };
  }

  private prunePending(): void {
    const now = Date.now();
    for (const [id, p] of this.pending) {
      if (now - p.createdAt > PENDING_INSPECT_TTL_MS) this.pending.delete(id);
    }
    while (this.pending.size >= PENDING_INSPECT_MAX) {
      const oldest = this.pending.keys().next().value;
      if (oldest === undefined) break;
      this.pending.delete(oldest);
    }
  }

  async pickMbtiles(): Promise<MbtilesPickResult> {
    if ((await this.store.count()) >= CUSTOM_MAP_SOURCES_MAX) return { ok: false, code: 'limit' };
    const filePath = await this.pickFile();
    if (!filePath) return { ok: false, code: 'cancelled' };
    try {
      const info = await inspectMbtilesFile(filePath);
      this.prunePending();
      const inspectId = randomUUID();
      this.pending.set(inspectId, { filePath, createdAt: Date.now() });
      const fallbackName = path.basename(filePath).replace(/\.mbtiles$/i, '');
      return {
        ok: true,
        inspectId,
        name: sanitizeCustomSourceName(info.name ?? fallbackName) ?? 'MBTiles',
        attribution: sanitizeCustomSourceAttribution(info.attribution ?? '') ?? '',
        format: info.format,
        minZoom: info.minZoom,
        maxZoom: info.maxZoom,
        fileBytes: info.fileBytes,
      };
    } catch (e: unknown) {
      if (e instanceof MbtilesError) return { ok: false, code: e.code };
      console.warn(
        '[offline-maps] mbtiles inspect failed:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      return { ok: false, code: 'io' };
    }
  }

  /**
   * Copy the inspected package into userData and register it.
   * Failure point: the copy. It goes to `<id>.mbtiles.tmp`, is re-inspected, then renamed; any
   * failure removes the temp file and leaves the source list untouched.
   */
  async importMbtiles(req: ImportMbtilesRequest): Promise<CustomMapSourceResult> {
    if (!req.confirmed) return { ok: false, code: 'not_confirmed' };
    const pending = typeof req.inspectId === 'string' ? this.pending.get(req.inspectId) : undefined;
    if (!pending || Date.now() - pending.createdAt > PENDING_INSPECT_TTL_MS) {
      this.pending.delete(req.inspectId);
      return { ok: false, code: 'unknown_inspect' };
    }
    const name = sanitizeCustomSourceName(req.name);
    if (!name) return { ok: false, code: 'name' };
    const attribution = sanitizeCustomSourceAttribution(req.attribution);
    if (!attribution) return { ok: false, code: 'attribution' };
    this.pending.delete(req.inspectId); // single use
    if ((await this.store.count()) >= CUSTOM_MAP_SOURCES_MAX) return { ok: false, code: 'limit' };

    const id = this.store.newMbtilesId();
    const dest = this.store.mbtilesPath(id);
    const tmp = `${dest}.tmp`;
    try {
      await fs.mkdir(this.store.mbtilesDir(), { recursive: true });
      await fs.copyFile(pending.filePath, tmp);
      const info = await inspectMbtilesFile(tmp);
      await fs.rename(tmp, dest);
      const added = await this.store.addMbtiles(id, {
        name,
        attribution,
        minZoom: info.minZoom,
        maxZoom: info.maxZoom,
        fileBytes: info.fileBytes,
      });
      if (!added.ok) {
        await fs.unlink(dest).catch(() => {
          // catch-no-log-ok cleanup
        });
        return added;
      }
      return { ok: true, source: toPublicInfo(added.value) };
    } catch (e: unknown) {
      await fs.unlink(tmp).catch(() => {
        // catch-no-log-ok cleanup
      });
      await fs.unlink(dest).catch(() => {
        // catch-no-log-ok cleanup
      });
      if (e instanceof MbtilesError) return { ok: false, code: e.code };
      console.warn(
        '[offline-maps] mbtiles import failed:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      return { ok: false, code: 'io' };
    }
  }

  /** Remove the allowlist entry first (persisted), then its cached tiles / package file. */
  async remove(id: string): Promise<{ ok: boolean }> {
    if (!isCustomMapSourceId(id)) return { ok: false };
    const removed = await this.store.remove(id);
    if (!removed) return { ok: false };
    try {
      if (removed.kind === 'mbtiles') {
        this.pool.close(id);
        await fs.unlink(this.store.mbtilesPath(id));
      } else {
        await this.getCache()?.clearSource(id);
      }
    } catch (e: unknown) {
      console.warn(
        '[offline-maps] custom source cleanup failed:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
    }
    return { ok: true };
  }

  dispose(): void {
    this.pool.closeAll();
    this.pending.clear();
  }
}
