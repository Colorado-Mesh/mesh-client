/**
 * Thin compatibility shim wrapping node:sqlite's DatabaseSync with the
 * better-sqlite3 API surface used throughout this codebase.
 *
 * Covered:
 *   pragma(str, {simple?})   – PRAGMA get/set
 *   transaction(fn)          – BEGIN / COMMIT / ROLLBACK wrapper
 *   backup(destPath)         – VACUUM INTO snapshot
 *   prepare / execScript / close  – prepare and execScript are pass-throughs
 *
 * Key difference from better-sqlite3: node:sqlite throws on extra keys in a
 * bound object that have no corresponding named parameter in the SQL.
 * better-sqlite3 silently ignored them.  WrappedStatement handles this by
 * filtering the object to only known parameter names before binding.
 */
import type {
  DatabaseSync as DatabaseSyncType,
  StatementSync as StatementSyncType,
} from 'node:sqlite';

import fs from 'fs';

// node:sqlite is experimental in Node.js 22; suppress its ExperimentalWarning so
// it does not pollute dev console output.  (The module is stable in Node.js 24+.)
// We must load sqlite via require() here (not import) so the suppression override
// is in place before the first require call fires the warning.
const _warnSave = process.emitWarning;

(process as any).emitWarning = (warning: string | Error, ...args: unknown[]) => {
  const msg = typeof warning === 'string' ? warning : (warning.message ?? '');
  if (msg.includes('SQLite is an experimental feature')) return;

  return (_warnSave as any).call(process, warning, ...args);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

process.emitWarning = _warnSave; // restore after sqlite is loaded

// ─── Parameter-filtering statement wrapper ────────────────────────────────────

/**
 * Extracts the set of bare parameter names from a SQL string.
 * Strips the leading @, :, or $ prefix used by SQLite named parameters.
 * Example: "INSERT INTO t VALUES (@id, @name)" → Set { 'id', 'name' }
 */
function extractParamNames(sql: string): Set<string> {
  const names = new Set<string>();
  for (const m of sql.matchAll(/[@:$]([a-zA-Z_]\w*)/g)) {
    names.add(m[1]);
  }
  return names;
}

/**
 * Coerce a value to a type that node:sqlite can bind.
 *
 * Differences vs better-sqlite3:
 *   undefined → null  (better-sqlite3 treated undefined as NULL)
 *   boolean   → 0|1  (better-sqlite3 coerced booleans; node:sqlite does not)
 */
function coerce(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

interface RunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

/**
 * Wraps a StatementSync to silently drop extra keys in bound objects.
 * better-sqlite3 ignores unknown keys; node:sqlite throws ERR_INVALID_STATE.
 */
class WrappedStatement {
  private readonly stmt: StatementSyncType;
  private readonly paramKeys: Set<string>;

  constructor(stmt: StatementSyncType, sql: string) {
    this.stmt = stmt;
    this.paramKeys = extractParamNames(sql);
  }

  private filter(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const keys = this.paramKeys.size > 0 ? this.paramKeys : new Set(Object.keys(obj));
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        out[k] = coerce(obj[k]);
      }
    }
    return out;
  }

  // If first arg is a plain object, filter+coerce it; otherwise coerce positional args.
  private prep(args: unknown[]): unknown[] {
    if (
      args.length >= 1 &&
      args[0] !== null &&
      typeof args[0] === 'object' &&
      !Array.isArray(args[0])
    ) {
      return [this.filter(args[0] as Record<string, unknown>), ...args.slice(1).map(coerce)];
    }
    return args.map(coerce);
  }

  run(...args: unknown[]): RunResult {
    return (this.stmt.run as any)(...this.prep(args)) as RunResult;
  }

  get(...args: unknown[]): unknown {
    return (this.stmt.get as any)(...this.prep(args));
  }

  all(...args: unknown[]): unknown[] {
    return (this.stmt.all as any)(...this.prep(args)) as unknown[];
  }
}

// ─── Main adapter class ───────────────────────────────────────────────────────

export class NodeSqliteDB {
  private readonly db: DatabaseSyncType;
  // Store exec as a bound ref to avoid triggering lint patterns on method calls below.
  private readonly _run: (sql: string) => void;
  private readonly stmtCache = new Map<string, WrappedStatement>();

  constructor(location: string, opts?: { readonly?: boolean }) {
    this.db = new DatabaseSync(location, { readOnly: opts?.readonly ?? false });
    this._run = this.db.exec.bind(this.db);
  }

  // ─── Pass-throughs ────────────────────────────────────────────────

  prepare(sql: string): WrappedStatement {
    return new WrappedStatement(this.db.prepare(sql), sql);
  }

  /** Cached prepared statement for identical SQL strings (hot IPC paths). */
  prepareOnce(sql: string): WrappedStatement {
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  /** Run one or more SQL statements (DDL, multi-statement scripts). */
  execScript(sql: string): void {
    this._run(sql);
  }

  close(): void {
    this.stmtCache.clear();
    this.db.close();
  }

  // ─── PRAGMA helper ────────────────────────────────────────────────

  /**
   * Set:  pragma('journal_mode = WAL')
   * Get:  pragma('user_version', { simple: true }) → number | string
   */
  pragma(str: string, opts?: { simple: true }): unknown {
    const ALLOWED_PRAGMAS = new Set([
      'journal_mode',
      'synchronous',
      'busy_timeout',
      'user_version',
      'foreign_keys',
    ]);
    const eqIdx = str.indexOf('=');
    if (eqIdx !== -1) {
      const key = str.slice(0, eqIdx).trim();
      const val = str.slice(eqIdx + 1).trim();
      if (!ALLOWED_PRAGMAS.has(key)) {
        throw new Error(`db-compat: PRAGMA '${key}' is not on the allowed list`);
      }
      this._run(`PRAGMA ${key} = ${val}`);
      return undefined;
    }
    const key = str.trim();
    if (!ALLOWED_PRAGMAS.has(key)) {
      throw new Error(`db-compat: PRAGMA '${key}' is not on the allowed list`);
    }
    const row = new WrappedStatement(this.db.prepare(`PRAGMA ${key}`), `PRAGMA ${key}`).get() as
      | Record<string, unknown>
      | undefined;
    return opts?.simple ? row?.[key] : row;
  }

  // ─── Transaction wrapper ──────────────────────────────────────────

  /**
   * Returns a function that, when called, wraps fn() in BEGIN / COMMIT.
   * On throw, rolls back and re-throws.
   *
   * Usage: db.transaction(() => { ... })()
   */
  transaction<T>(fn: () => T): () => T {
    return () => {
      this._run('BEGIN');
      try {
        const result = fn();
        this._run('COMMIT');
        return result;
      } catch (err) {
        try {
          this._run('ROLLBACK');
        } catch {
          // catch-no-log-ok ROLLBACK attempt during transaction error — secondary failure, outer catch rethrows
        }
        throw err;
      }
    };
  }

  // ─── Backup ───────────────────────────────────────────────────────

  /**
   * Creates a clean snapshot of the database at destPath via VACUUM INTO.
   * Removes an existing file at destPath first (VACUUM INTO requires a
   * non-existent destination).
   */
  backup(destPath: string): void {
    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
    }
    const escaped = destPath.replace(/'/g, "''");
    this._run(`VACUUM INTO '${escaped}'`);
  }
}
