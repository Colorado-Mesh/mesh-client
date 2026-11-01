import { randomBytes } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import {
  type AddXyzSourceRequest,
  CUSTOM_MAP_SOURCES_MAX,
  type CustomMapSourceErrorCode,
  type CustomMapSourceId,
  type CustomMapSourceInfo,
  type CustomMapSourceKind,
  customMapSourceKind,
  isCustomMapSourceId,
  isValidCustomMaxNativeZoom,
  sanitizeCustomSourceAttribution,
  sanitizeCustomSourceName,
  validateXyzTemplate,
} from '@/shared/offlineMaps/customMapSources';

import { sanitizeLogMessage } from '../log-service';

/** Persisted allowlist entry. `urlTemplate` stays in the main process (may embed an API key). */
export interface CustomMapSourceRecord extends CustomMapSourceInfo {
  /** Epoch ms of the user's explicit confirmation. */
  confirmedAt: number;
  urlTemplate?: string;
}

interface CustomSourcesFile {
  version: 1;
  sources: CustomMapSourceRecord[];
}

export type StoreResult<T> = { ok: true; value: T } | { ok: false; code: CustomMapSourceErrorCode };

export function toPublicInfo(record: CustomMapSourceRecord): CustomMapSourceInfo {
  // Explicit pick: never leak `urlTemplate` (may contain an API key) or future private fields.
  return {
    id: record.id,
    kind: record.kind,
    name: record.name,
    attribution: record.attribution,
    addedAt: record.addedAt,
    ...(record.host != null ? { host: record.host } : {}),
    ...(record.maxNativeZoom != null ? { maxNativeZoom: record.maxNativeZoom } : {}),
    ...(record.minZoom != null ? { minZoom: record.minZoom } : {}),
    ...(record.fileBytes != null ? { fileBytes: record.fileBytes } : {}),
  };
}

function newSourceId(kind: CustomMapSourceKind): CustomMapSourceId {
  return `${kind}-${randomBytes(6).toString('hex')}`;
}

/**
 * Persistent allowlist of user-confirmed custom map sources. Records are re-validated on load, so a
 * hand-edited or corrupt file can never introduce an unvalidated host.
 *
 * Failure behavior: a corrupt file is moved aside (`*.corrupt-<ts>`) and the list starts empty; writes
 * are atomic (temp + rename) and serialized, so a failed write leaves the previous list intact.
 */
export class CustomMapSourceStore {
  private records: CustomMapSourceRecord[] | null = null;
  private loading: Promise<void> | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly baseDir: string) {}

  private filePath(): string {
    return path.join(this.baseDir, 'custom-sources.json');
  }

  mbtilesDir(): string {
    return path.join(this.baseDir, 'mbtiles');
  }

  mbtilesPath(id: string): string {
    if (!isCustomMapSourceId(id) || customMapSourceKind(id) !== 'mbtiles') {
      throw new Error('Invalid MBTiles source id');
    }
    return path.join(this.mbtilesDir(), `${id}.mbtiles`);
  }

  private async ensureLoaded(): Promise<CustomMapSourceRecord[]> {
    if (this.records) return this.records;
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    await this.loading;
    return this.records ?? [];
  }

  private async load(): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath(), 'utf8');
    } catch {
      // catch-no-log-ok missing file → empty list
      this.records = [];
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<CustomSourcesFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.sources)) throw new Error('bad shape');
      const out: CustomMapSourceRecord[] = [];
      for (const candidate of parsed.sources) {
        const rec = this.revalidate(candidate);
        if (rec) out.push(rec);
        else console.warn('[offline-maps] dropped invalid custom source record');
      }
      this.records = out.slice(0, CUSTOM_MAP_SOURCES_MAX);
    } catch (e: unknown) {
      console.warn(
        '[offline-maps] custom-sources.json unreadable; starting empty:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      await fs.rename(this.filePath(), `${this.filePath()}.corrupt-${Date.now()}`).catch(() => {
        // catch-no-log-ok best-effort quarantine
      });
      this.records = [];
    }
  }

  private revalidate(candidate: unknown): CustomMapSourceRecord | null {
    if (typeof candidate !== 'object' || candidate === null) return null;
    const c = candidate as Partial<CustomMapSourceRecord>;
    if (!isCustomMapSourceId(c.id)) return null;
    const kind = customMapSourceKind(c.id);
    if (c.kind !== kind) return null;
    const name = sanitizeCustomSourceName(c.name);
    const attribution = sanitizeCustomSourceAttribution(c.attribution);
    if (!name || !attribution || typeof c.confirmedAt !== 'number' || c.confirmedAt <= 0) {
      return null;
    }
    const base = {
      id: c.id,
      kind,
      name,
      attribution,
      addedAt: typeof c.addedAt === 'number' ? c.addedAt : c.confirmedAt,
      confirmedAt: c.confirmedAt,
    };
    if (kind === 'xyz') {
      const v = validateXyzTemplate(c.urlTemplate);
      if (!v.ok) return null;
      return {
        ...base,
        host: v.host,
        urlTemplate: v.template,
        ...(isValidCustomMaxNativeZoom(c.maxNativeZoom) ? { maxNativeZoom: c.maxNativeZoom } : {}),
      };
    }
    return {
      ...base,
      ...(isValidCustomMaxNativeZoom(c.maxNativeZoom) ? { maxNativeZoom: c.maxNativeZoom } : {}),
      ...(isValidCustomMaxNativeZoom(c.minZoom) ? { minZoom: c.minZoom } : {}),
      ...(typeof c.fileBytes === 'number' && c.fileBytes >= 0 ? { fileBytes: c.fileBytes } : {}),
    };
  }

  private async persist(records: CustomMapSourceRecord[]): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const tmp = path.join(this.baseDir, `custom-sources.${process.pid}.${Date.now()}.tmp`);
    const body: CustomSourcesFile = { version: 1, sources: records };
    try {
      await fs.writeFile(tmp, JSON.stringify(body, null, 2), 'utf8');
      await fs.rename(tmp, this.filePath());
    } catch (e: unknown) {
      await fs.unlink(tmp).catch(() => {
        // catch-no-log-ok cleanup
      });
      throw e;
    }
  }

  /** Serialized read-modify-write. The in-memory list only changes after the file is written. */
  private mutate<T>(
    fn: (current: CustomMapSourceRecord[]) => { next: CustomMapSourceRecord[]; result: T },
  ): Promise<T> {
    const run = this.chain.then(async () => {
      const current = await this.ensureLoaded();
      const { next, result } = fn(current);
      await this.persist(next);
      this.records = next;
      return result;
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async list(): Promise<CustomMapSourceRecord[]> {
    return [...(await this.ensureLoaded())];
  }

  async get(id: string): Promise<CustomMapSourceRecord | null> {
    if (!isCustomMapSourceId(id)) return null;
    return (await this.ensureLoaded()).find((r) => r.id === id) ?? null;
  }

  async addXyz(req: AddXyzSourceRequest): Promise<StoreResult<CustomMapSourceRecord>> {
    if (!req.confirmed) return { ok: false, code: 'not_confirmed' };
    const name = sanitizeCustomSourceName(req.name);
    if (!name) return { ok: false, code: 'name' };
    const attribution = sanitizeCustomSourceAttribution(req.attribution);
    if (!attribution) return { ok: false, code: 'attribution' };
    if (req.maxNativeZoom != null && !isValidCustomMaxNativeZoom(req.maxNativeZoom)) {
      return { ok: false, code: 'zoom' };
    }
    const v = validateXyzTemplate(req.urlTemplate);
    if (!v.ok) return { ok: false, code: v.code };
    const now = Date.now();
    return this.mutate<StoreResult<CustomMapSourceRecord>>((current) => {
      if (current.length >= CUSTOM_MAP_SOURCES_MAX) {
        return { next: current, result: { ok: false as const, code: 'limit' as const } };
      }
      const record: CustomMapSourceRecord = {
        id: newSourceId('xyz'),
        kind: 'xyz',
        name,
        attribution,
        addedAt: now,
        confirmedAt: now,
        host: v.host,
        urlTemplate: v.template,
        ...(req.maxNativeZoom != null ? { maxNativeZoom: req.maxNativeZoom } : {}),
      };
      return { next: [...current, record], result: { ok: true as const, value: record } };
    });
  }

  /** Reserve an id + count slot before the package copy; caller finalizes with `addMbtiles`. */
  newMbtilesId(): CustomMapSourceId {
    return newSourceId('mbtiles');
  }

  async addMbtiles(
    id: CustomMapSourceId,
    meta: {
      name: string;
      attribution: string;
      minZoom: number;
      maxZoom: number;
      fileBytes: number;
    },
  ): Promise<StoreResult<CustomMapSourceRecord>> {
    const now = Date.now();
    return this.mutate<StoreResult<CustomMapSourceRecord>>((current) => {
      if (current.length >= CUSTOM_MAP_SOURCES_MAX) {
        return { next: current, result: { ok: false as const, code: 'limit' as const } };
      }
      const record: CustomMapSourceRecord = {
        id,
        kind: 'mbtiles',
        name: meta.name,
        attribution: meta.attribution,
        addedAt: now,
        confirmedAt: now,
        minZoom: meta.minZoom,
        maxNativeZoom: meta.maxZoom,
        fileBytes: meta.fileBytes,
      };
      return { next: [...current, record], result: { ok: true as const, value: record } };
    });
  }

  async count(): Promise<number> {
    return (await this.ensureLoaded()).length;
  }

  /** Remove the record (persisted first). Caller removes cache dir / package file afterward. */
  async remove(id: string): Promise<CustomMapSourceRecord | null> {
    if (!isCustomMapSourceId(id)) return null;
    return this.mutate((current) => {
      const found = current.find((r) => r.id === id) ?? null;
      return { next: found ? current.filter((r) => r.id !== id) : current, result: found };
    });
  }
}
