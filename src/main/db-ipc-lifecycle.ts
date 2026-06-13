import { DATABASE_CLOSED_MESSAGE, getDatabaseIfOpen, isDatabaseClosed } from './database';
import type { NodeSqliteDB } from './db-compat';
import { sanitizeLogMessage } from './sanitize-log-message';

/** Returns an open DB handle or null during shutdown (logs once per call site). */
export function getDbForIpc(channel: string): NodeSqliteDB | null {
  const db = getDatabaseIfOpen();
  if (!db) {
    console.debug(`[IPC] ${channel}: skipped (database closed)`);
    return null;
  }
  return db;
}

/** Swallow DB writes during app quit; rethrow real failures for Electron IPC error reporting. */
export function finishDbIpcHandler(channel: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (isDatabaseClosed() || message === DATABASE_CLOSED_MESSAGE) {
    console.debug(`[IPC] ${channel}: skipped (database closed)`);
    return;
  }
  console.error(`[IPC] ${channel} failed:`, sanitizeLogMessage(message));
  throw err;
}

export function finishDbIpcReadHandler<T>(channel: string, err: unknown, fallback: T): T {
  const message = err instanceof Error ? err.message : String(err);
  if (isDatabaseClosed() || message === DATABASE_CLOSED_MESSAGE) {
    console.debug(`[IPC] ${channel}: skipped (database closed)`);
    return fallback;
  }
  finishDbIpcHandler(channel, err);
  return fallback;
}
