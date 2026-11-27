/**
 * `node:sqlite` shim for the mobile host worker, backed by the official SQLite WebAssembly build.
 *
 * `src/main/db-compat.ts` wraps `DatabaseSync` / `StatementSync`; this module implements exactly
 * the surface it (and `database.ts`) uses: open (read-only or read/write), `exec`, `prepare`,
 * `run` / `get` / `all` / `iterate` with node:sqlite binding rules (a leading object binds named
 * parameters by bare name, remaining arguments bind anonymous `?` parameters), and `close`.
 *
 * Storage backends:
 * - `opfs-sahpool` (preferred): files live in an OPFS SyncAccessHandle pool, which is fully
 *   synchronous inside a worker. Writes are durable when each statement completes.
 * - `memory` (fallback when OPFS sync handles are unavailable): the database is deserialized
 *   from a snapshot at open and serialized back through `setMemorySnapshotWriter` after changes
 *   (debounced, plus on app pause). **Failure window:** changes made after the last successful
 *   snapshot are lost if the app is killed before the next flush; flush failures are logged and
 *   retried on the next change or pause.
 *
 * WAL is not supported by either VFS; `PRAGMA journal_mode = WAL` leaves the rollback journal in
 * place (SQLite returns the current mode instead of failing), which keeps crash safety.
 */

export type Sqlite3 = any;
export type PoolUtil = any;
export type Oo1Db = any;
type Oo1Stmt = any;

export interface Runtime {
  sqlite3: Sqlite3;
  pool: PoolUtil | null;
}

let runtime: Runtime | null = null;
const memorySnapshots = new Map<string, Uint8Array>();
let memorySnapshotWriter: ((path: string, bytes: Uint8Array) => Promise<void>) | null = null;
const openMemoryDbs = new Set<DatabaseSyncShim>();

export function setSqliteRuntime(r: Runtime): void {
  runtime = r;
}

export function getSqliteRuntime(): Runtime {
  if (!runtime) throw new Error('node:sqlite (mobile): SQLite runtime not initialized');
  return runtime;
}

/** Memory backend: snapshot bytes loaded at boot, keyed by database path. */
export function seedMemorySnapshot(path: string, bytes: Uint8Array): void {
  memorySnapshots.set(path, bytes);
}

export function setMemorySnapshotWriter(
  writer: (path: string, bytes: Uint8Array) => Promise<void>,
): void {
  memorySnapshotWriter = writer;
}

/** Serialize every dirty in-memory database now (app pause / before quit). */
export async function flushMemoryDatabases(): Promise<void> {
  await Promise.all([...openMemoryDbs].map((d) => d.flushSnapshot()));
}

export function listSqliteFiles(): string[] {
  const r = getSqliteRuntime();
  if (r.pool) return (r.pool.getFileNames() as string[]).slice();
  return [...memorySnapshots.keys()];
}

export function sqliteFileExists(path: string): boolean {
  return listSqliteFiles().includes(path);
}

export function exportSqliteFile(path: string): Uint8Array {
  const r = getSqliteRuntime();
  if (r.pool) return r.pool.exportFile(path) as Uint8Array;
  for (const d of openMemoryDbs) if (d.location === path) return d.serialize();
  const snap = memorySnapshots.get(path);
  if (!snap)
    throw Object.assign(new Error(`ENOENT: no such file, open '${path}'`), { code: 'ENOENT' });
  return snap.slice();
}

export function importSqliteFile(path: string, bytes: Uint8Array): void {
  const r = getSqliteRuntime();
  if (r.pool) {
    r.pool.importDb(path, bytes);
    return;
  }
  memorySnapshots.set(path, bytes.slice());
  void memorySnapshotWriter?.(path, bytes.slice());
}

export function unlinkSqliteFile(path: string): boolean {
  const r = getSqliteRuntime();
  if (r.pool) return Boolean(r.pool.unlink(path));
  const had = memorySnapshots.delete(path);
  if (had) void memorySnapshotWriter?.(path, new Uint8Array(0));
  return had;
}

const SNAPSHOT_DEBOUNCE_MS = 1500;
const stmtRegistry =
  typeof FinalizationRegistry !== 'undefined'
    ? new FinalizationRegistry<Oo1Stmt>((stmt) => {
        try {
          stmt.finalize();
        } catch {
          // catch-no-log-ok database already closed; oo1 finalized the statement with it
        }
      })
    : null;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    !ArrayBuffer.isView(v) &&
    !(v instanceof ArrayBuffer)
  );
}

function toBindable(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Uint8Array && v.constructor !== Uint8Array) {
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice();
  }
  if (ArrayBuffer.isView(v) && !(v instanceof Uint8Array)) {
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice();
  }
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return v;
}

export class StatementSyncShim {
  private readonly stmt: Oo1Stmt;
  private readonly paramNames: (string | null)[];
  readonly sourceSQL: string;

  constructor(
    private readonly owner: DatabaseSyncShim,
    sql: string,
  ) {
    const { sqlite3 } = getSqliteRuntime();
    this.sourceSQL = sql;
    this.stmt = owner.oo1().prepare(sql);
    const n = this.stmt.parameterCount as number;
    this.paramNames = [];
    for (let i = 1; i <= n; i++) {
      const name = sqlite3.capi.sqlite3_bind_parameter_name(this.stmt.pointer, i) as string | null;
      this.paramNames.push(name ?? null);
    }
    stmtRegistry?.register(this, this.stmt);
  }

  private bindArgs(args: unknown[]): void {
    this.stmt.reset(true);
    if (this.paramNames.length === 0) return;
    let named: Record<string, unknown> | null = null;
    let positional = args;
    if (args.length > 0 && isPlainObject(args[0])) {
      named = args[0];
      positional = args.slice(1);
    }
    let pos = 0;
    for (let i = 0; i < this.paramNames.length; i++) {
      const full = this.paramNames[i];
      const idx = i + 1;
      if (full && !full.startsWith('?')) {
        if (!named) continue;
        const bare = full.slice(1);
        if (Object.prototype.hasOwnProperty.call(named, bare)) {
          this.stmt.bind(idx, toBindable(named[bare]));
        } else if (Object.prototype.hasOwnProperty.call(named, full)) {
          this.stmt.bind(idx, toBindable(named[full]));
        }
        continue;
      }
      if (pos < positional.length) {
        this.stmt.bind(idx, toBindable(positional[pos++]));
      }
    }
  }

  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    const { sqlite3 } = getSqliteRuntime();
    this.bindArgs(args);
    try {
      while (this.stmt.step()) {
        // drain RETURNING rows
      }
    } finally {
      this.stmt.reset();
    }
    const dbPtr = this.owner.oo1().pointer;
    const changes = Number(sqlite3.capi.sqlite3_changes(dbPtr));
    const rowid = sqlite3.capi.sqlite3_last_insert_rowid(dbPtr) as number | bigint;
    this.owner.noteWrite();
    return {
      changes,
      lastInsertRowid:
        typeof rowid === 'bigint' && rowid <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(rowid)
          : rowid,
    };
  }

  get(...args: unknown[]): Record<string, unknown> | undefined {
    this.bindArgs(args);
    try {
      if (!this.stmt.step()) return undefined;
      return this.stmt.get({}) as Record<string, unknown>;
    } finally {
      this.stmt.reset();
      this.owner.noteMaybeWrite(this.sourceSQL);
    }
  }

  all(...args: unknown[]): Record<string, unknown>[] {
    this.bindArgs(args);
    const rows: Record<string, unknown>[] = [];
    try {
      while (this.stmt.step()) rows.push(this.stmt.get({}) as Record<string, unknown>);
    } finally {
      this.stmt.reset();
      this.owner.noteMaybeWrite(this.sourceSQL);
    }
    return rows;
  }

  *iterate(...args: unknown[]): Generator<Record<string, unknown>> {
    for (const row of this.all(...args)) yield row;
  }

  columns(): { name: string }[] {
    return (this.stmt.getColumnNames() as string[]).map((name) => ({ name }));
  }

  get expandedSQL(): string {
    return this.sourceSQL;
  }

  setReadBigInts(): void {}
  setAllowBareNamedParameters(): void {}
  setAllowUnknownNamedParameters(): void {}
  setReturnArrays(): void {}

  /** @internal */
  finalize(): void {
    stmtRegistry?.unregister(this);
    try {
      this.stmt.finalize();
    } catch {
      // catch-no-log-ok already finalized by db.close()
    }
  }
}

export class DatabaseSyncShim {
  private db: Oo1Db | null = null;
  private readonly memory: boolean;
  private readonly readOnly: boolean;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;

  constructor(
    readonly location: string,
    opts: { readOnly?: boolean; open?: boolean } = {},
  ) {
    const r = getSqliteRuntime();
    this.readOnly = opts.readOnly === true;
    this.memory = !r.pool && location !== ':memory:';
    if (opts.open !== false) this.open();
  }

  open(): void {
    if (this.db) return;
    const { sqlite3, pool } = getSqliteRuntime();
    const flags = this.readOnly ? 'r' : 'c';
    if (this.location === ':memory:') {
      this.db = new sqlite3.oo1.DB(':memory:', 'c');
      return;
    }
    if (pool) {
      if (this.readOnly && !sqliteFileExists(this.location)) {
        throw Object.assign(new Error('unable to open database file'), {
          code: 'ERR_SQLITE_ERROR',
          errcode: 14,
        });
      }
      this.db = new pool.OpfsSAHPoolDb(this.location, flags);
      return;
    }
    // Memory backend: load the snapshot (if any) into a fresh in-memory database.
    this.db = new sqlite3.oo1.DB(':memory:', 'c');
    const snap = memorySnapshots.get(this.location);
    if (snap && snap.byteLength > 0) {
      const p = sqlite3.wasm.allocFromTypedArray(snap);
      const rc = sqlite3.capi.sqlite3_deserialize(
        this.db.pointer,
        'main',
        p,
        snap.byteLength,
        snap.byteLength,
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
      ) as number;
      if (rc !== 0) {
        throw new Error(
          `node:sqlite (mobile): could not load snapshot for ${this.location} (rc=${rc})`,
        );
      }
    } else if (this.readOnly) {
      this.db.close();
      this.db = null;
      throw Object.assign(new Error('unable to open database file'), {
        code: 'ERR_SQLITE_ERROR',
        errcode: 14,
      });
    }
    openMemoryDbs.add(this);
  }

  get isOpen(): boolean {
    return this.db !== null;
  }

  get isTransaction(): boolean {
    const { sqlite3 } = getSqliteRuntime();
    return this.db ? sqlite3.capi.sqlite3_get_autocommit(this.db.pointer) === 0 : false;
  }

  /** @internal */
  oo1(): Oo1Db {
    if (!this.db)
      throw Object.assign(new Error('database is not open'), { code: 'ERR_INVALID_STATE' });
    return this.db;
  }

  exec(sql: string): void {
    this.oo1().exec(sql);
    this.noteMaybeWrite(sql);
  }

  prepare(sql: string): StatementSyncShim {
    return new StatementSyncShim(this, sql);
  }

  close(): void {
    if (!this.db)
      throw Object.assign(new Error('database is not open'), { code: 'ERR_INVALID_STATE' });
    if (this.memory && this.dirty) {
      try {
        const bytes = this.serialize();
        memorySnapshots.set(this.location, bytes);
        void memorySnapshotWriter?.(this.location, bytes);
      } catch (e) {
        console.error(
          `mcL1515 [mobile/sqlite] final snapshot before close failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.db.close();
    this.db = null;
    openMemoryDbs.delete(this);
  }

  enableLoadExtension(): void {
    throw new Error('Extensions are not available on mobile');
  }

  function(): void {
    throw new Error('Custom SQL functions are not available on mobile');
  }

  /** @internal */
  noteWrite(): void {
    if (!this.memory) return;
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushSnapshot();
    }, SNAPSHOT_DEBOUNCE_MS);
  }

  /** @internal Statements via `get`/`all`/`exec` can also write (INSERT … RETURNING, DDL). */
  noteMaybeWrite(sql: string): void {
    if (!this.memory) return;
    if (
      /^\s*(SELECT|PRAGMA\s+\w+\s*$|EXPLAIN|WITH\b[^;]*\bSELECT\b(?![\s\S]*\b(INSERT|UPDATE|DELETE)\b))/i.test(
        sql,
      )
    )
      return;
    this.noteWrite();
  }

  /** @internal */
  serialize(): Uint8Array {
    const { sqlite3 } = getSqliteRuntime();
    return sqlite3.capi.sqlite3_js_db_export(this.oo1().pointer) as Uint8Array;
  }

  /** @internal */
  async flushSnapshot(): Promise<void> {
    if (!this.memory || !this.dirty || !this.db) return;
    if (this.flushing) return this.flushing;
    // Never snapshot mid-transaction: the next statement outside it re-arms the flush.
    if (this.isTransaction) {
      this.noteWrite();
      return;
    }
    this.dirty = false;
    const bytes = this.serialize();
    memorySnapshots.set(this.location, bytes);
    this.flushing = (memorySnapshotWriter?.(this.location, bytes) ?? Promise.resolve())
      .catch((e: unknown) => {
        this.dirty = true;
        console.error(
          `mcL1516 [mobile/sqlite] snapshot write failed (will retry): ${e instanceof Error ? e.message : String(e)}`,
        );
      })
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }
}

export const DatabaseSync = DatabaseSyncShim;
export const StatementSync = StatementSyncShim;
export const constants = {
  SQLITE_CHANGESET_OMIT: 0,
  SQLITE_CHANGESET_REPLACE: 1,
  SQLITE_CHANGESET_ABORT: 2,
};
export default { DatabaseSync, StatementSync, constants };
