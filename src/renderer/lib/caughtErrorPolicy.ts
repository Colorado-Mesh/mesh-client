/**
 * Renderer catch-block logging helpers. Soft catches use debug (gated by verbose logging
 * when forwarded to main). No crash-dialog IPC — use Export for GitHub for support zips.
 * Never rethrow.
 */
import { formatLogId, type LogMessageId } from '@/shared/logMessageIds';

import { errLikeToLogString } from './errLikeToLogString';

/** Soft / expected catch — debug only (no mcL####). */
export function logCaughtDebug(tag: string, err: unknown, detail?: string): void {
  if (detail) {
    console.debug('[caughtErrorPolicy] soft catch: %s %s %s', tag, detail, errLikeToLogString(err));
    return;
  }
  console.debug('[caughtErrorPolicy] soft catch: %s %s', tag, errLikeToLogString(err));
}

/** Unexpected but non-fatal — warn with required log ID. */
export function logCaughtWarn(id: LogMessageId, tag: string, err: unknown, detail?: string): void {
  const message = detail
    ? `[${tag}] caught warn ${detail}: ${errLikeToLogString(err)}`
    : `[${tag}] caught warn: ${errLikeToLogString(err)}`;
  console.warn(formatLogId(id, message));
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
