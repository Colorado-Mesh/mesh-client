/**
 * Catch-block logging helpers: soft catches use debug (gated by verbose logging);
 * unexpected integrity failures use warn/error + optional crash-report dialog.
 * Never rethrow — the app must keep running.
 */
import {
  formatLogId,
  LOG_ID_CAUGHT_SERIOUS,
  LOG_ID_CAUGHT_WARN,
  type LogMessageId,
} from '../shared/logMessageIds';
import { showCrashReportDialog } from './crash-report-dialog';
import { flushLogBeforeQuit } from './log-service';
import { sanitizeLogMessage } from './sanitize-log-message';

function errDetail(err: unknown): string {
  if (err instanceof Error) {
    return sanitizeLogMessage(err.stack ?? err.message);
  }
  if (typeof err === 'string') return sanitizeLogMessage(err);
  if (typeof err === 'number' || typeof err === 'boolean' || typeof err === 'bigint') {
    return sanitizeLogMessage(String(err));
  }
  if (err == null) return 'null';
  try {
    return sanitizeLogMessage(JSON.stringify(err));
  } catch (e: unknown) {
    console.debug(
      '[caughtErrorPolicy] errDetail stringify failed:',
      sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );
    return sanitizeLogMessage('[unserializable]');
  }
}

/** Soft / expected catch — debug only (no mcL####). Satisfies check:silent-catches. */
export function logCaughtDebug(tag: string, err: unknown, detail?: string): void {
  if (detail) {
    console.debug(
      '[caughtErrorPolicy] soft catch: %s %s %s',
      sanitizeLogMessage(tag),
      sanitizeLogMessage(detail),
      errDetail(err),
    );
    return;
  }
  console.debug('[caughtErrorPolicy] soft catch: %s %s', sanitizeLogMessage(tag), errDetail(err));
}

/** Unexpected but non-fatal — warn with required log ID. */
export function logCaughtWarn(id: LogMessageId, tag: string, err: unknown, detail?: string): void {
  const message = detail
    ? `[${sanitizeLogMessage(tag)}] caught warn ${sanitizeLogMessage(detail)}: ${errDetail(err)}`
    : `[${sanitizeLogMessage(tag)}] caught warn: ${errDetail(err)}`;
  console.warn(formatLogId(id, message));
}

/**
 * Serious unexpected failure: error log + consent-gated crash-report dialog.
 * Does not rethrow or exit.
 */
export function reportCaughtSeriousError(id: LogMessageId, source: string, err: unknown): void {
  const error = err instanceof Error ? err : new Error(errDetail(err));
  console.error(
    formatLogId(
      id,
      `[main] Caught serious error (${sanitizeLogMessage(source)}): ${errDetail(err)}`,
    ),
  );
  void flushLogBeforeQuit();
  showCrashReportDialog({ source: `caught:${source}`, error });
}

/** Prefix a warn message with a registered log ID. */
export function warnWithLogId(id: LogMessageId, ...args: unknown[]): void {
  if (args.length === 0) {
    console.warn(id);
    return;
  }
  const [first, ...rest] = args;
  if (typeof first === 'string') {
    console.warn(formatLogId(id, first), ...rest);
  } else {
    console.warn(id, first, ...rest);
  }
}

/** Prefix an error message with a registered log ID. */
export function errorWithLogId(id: LogMessageId, ...args: unknown[]): void {
  if (args.length === 0) {
    console.error(id);
    return;
  }
  const [first, ...rest] = args;
  if (typeof first === 'string') {
    console.error(formatLogId(id, first), ...rest);
  } else {
    console.error(id, first, ...rest);
  }
}

/** Re-export reserved IDs so main call sites can import from one module. */
export { LOG_ID_CAUGHT_SERIOUS, LOG_ID_CAUGHT_WARN };
