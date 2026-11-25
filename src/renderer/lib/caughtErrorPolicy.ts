/**
 * Renderer soft-catch logging. Debug only (gated by verbose logging when forwarded to main).
 * No crash-dialog IPC — use Export for GitHub for support zips. Never rethrow.
 * Only `logCaughtDebug` is needed so far; keep this file minimal until a call site needs more.
 */
import { errLikeToLogString } from './errLikeToLogString';

/** Soft / expected catch — debug only (no mcL####). */
export function logCaughtDebug(tag: string, err: unknown, detail?: string): void {
  if (detail) {
    console.debug('[caughtErrorPolicy] soft catch: %s %s %s', tag, detail, errLikeToLogString(err));
    return;
  }
  console.debug('[caughtErrorPolicy] soft catch: %s %s', tag, errLikeToLogString(err));
}
