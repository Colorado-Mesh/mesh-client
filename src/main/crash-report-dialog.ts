/**
 * Crash report dialog — offers to open a pre-filled GitHub issue on fatal errors.
 *
 * Replaces bare `dialog.showErrorBox` in the uncaughtException / unhandledRejection handlers
 * with a two-button dialog: "Report on GitHub" (opens browser) or "Dismiss".
 *
 * Design:
 * - No tokens, proxies, or telemetry — user controls submission via their own GitHub account
 * - Pre-filled issue URL with platform, version, error, and stack trace
 * - 60s cooldown prevents dialog spam from error loops
 * - `showMessageBoxSync` for synchronous uncaughtException context
 */
import { release as osRelease } from 'node:os';

import { app, dialog, shell } from 'electron';

import { sanitizeLogMessage } from './sanitize-log-message';

const REPO_OWNER = 'Colorado-Mesh';
const REPO_NAME = 'mesh-client';
const ISSUE_TEMPLATE = 'crash_report.md';

/** Max URL length safe for most browsers and GitHub's server. */
const MAX_URL_LENGTH = 8000;
/** Max stack trace chars to include in the issue body. */
const MAX_STACK_LENGTH = 1500;
/** Cooldown between crash dialogs to avoid spam from error loops. */
const CRASH_DIALOG_COOLDOWN_MS = 60_000;

export interface CrashContext {
  /** 'uncaughtException' | 'unhandledRejection' | 'render-process-gone' */
  source: string;
  error: Error | string;
}

function getAppVersion(): string {
  try {
    return app.getVersion();
  } catch {
    // catch-no-log-ok app.getVersion() rarely throws; version is cosmetic only
    return 'unknown';
  }
}

function getPlatformLabel(): string {
  const labels: Record<string, string> = {
    darwin: 'macOS',
    linux: 'Linux',
    win32: 'Windows',
  };
  return labels[process.platform] ?? process.platform;
}

function formatErrorForTitle(ctx: CrashContext): string {
  const msg = ctx.error instanceof Error ? ctx.error.message : ctx.error;
  const cleaned = sanitizeLogMessage(msg).replace(/\n/g, ' ').slice(0, 80);
  return `[Crash] ${cleaned}`;
}

/**
 * Sanitize text for inclusion in the GitHub issue body.
 * Unlike sanitizeLogMessage (which collapses all whitespace including newlines),
 * this preserves newlines so stack traces remain readable in code fences.
 */
function sanitizeForBody(text: string): string {
  return text
    .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F\u2028\u2029]+/g, ' ') // eslint-disable-line no-control-regex
    .replace(/[ \t]+/g, ' ');
}

function formatErrorForBody(ctx: CrashContext): string {
  const msg = ctx.error instanceof Error ? ctx.error.message : ctx.error;
  const stack =
    ctx.error instanceof Error && ctx.error.stack
      ? ctx.error.stack.slice(0, MAX_STACK_LENGTH)
      : '(no stack trace)';

  const platform = getPlatformLabel();
  const version = getAppVersion();
  const arch = process.arch;
  const os = osRelease();
  const packaged = app.isPackaged ? 'yes' : 'no (dev)';

  return [
    '**Crash source:** `' + ctx.source + '`',
    '',
    '**Desktop:**',
    `- OS: ${platform} ${os} (${arch})`,
    `- App version: ${version}`,
    `- Packaged: ${packaged}`,
    '',
    '**Error message:**',
    '```',
    sanitizeForBody(msg),
    '```',
    '',
    '**Stack trace:**',
    '```',
    sanitizeForBody(stack),
    '```',
    '',
    '---',
    '',
    '**Diagnostic bundle:**',
    'Please also attach the zip from **App → Support / Bug reports → Export for GitHub** if the app is still responsive.',
    '',
    '**Do not** attach **Export for Developer** or `mesh-client.db` to this public issue — the database may contain saved passwords.',
    '',
    '**Steps to reproduce (please fill in):**',
    '1. ',
    '2. ',
    '3. ',
    '',
    '**Additional context:**',
    '',
  ].join('\n');
}

/**
 * Build a GitHub new-issue URL pre-filled with crash context.
 * Truncates body iteratively until the encoded URL fits within browser limits.
 */
export function buildCrashReportUrl(ctx: CrashContext): string {
  const title = formatErrorForTitle(ctx);
  let body = formatErrorForBody(ctx);

  const baseUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/new`;

  function makeUrl(b: string): string {
    const params = new URLSearchParams({ template: ISSUE_TEMPLATE, title, body: b });
    return `${baseUrl}?${params.toString()}`;
  }

  let url = makeUrl(body);

  // Iteratively shrink body until the percent-encoded URL fits.
  // Multi-byte characters expand during encoding, so we must measure the final URL.
  while (url.length > MAX_URL_LENGTH && body.length > 200) {
    body = body.slice(0, Math.floor(body.length * 0.75));
    body += '\n\n_(truncated — attach Export for GitHub zip for full details)_';
    url = makeUrl(body);
  }

  return url;
}

let lastCrashDialogAt = 0;

/**
 * Show a crash dialog with "Report on GitHub" and "Dismiss" buttons.
 *
 * Uses `dialog.showMessageBoxSync` (synchronous) because the uncaughtException handler
 * is a sync context — the dialog must block before the process potentially exits.
 *
 * Returns true if the user chose to report.
 */
export function showCrashReportDialog(ctx: CrashContext): boolean {
  const now = Date.now();
  if (now - lastCrashDialogAt < CRASH_DIALOG_COOLDOWN_MS) {
    return false;
  }
  lastCrashDialogAt = now;

  const msg = ctx.error instanceof Error ? ctx.error.message : ctx.error;
  const detail = [
    `Source: ${ctx.source}`,
    '',
    sanitizeLogMessage(msg).slice(0, 500),
    '',
    'Would you like to report this crash on GitHub?',
    '(Opens your browser with a pre-filled issue. No data is sent automatically.)',
  ].join('\n');

  try {
    const response = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Mesh-Client — Unexpected Error',
      message: 'An unexpected error occurred.',
      detail,
      buttons: ['Report on GitHub', 'Dismiss'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });

    if (response === 0) {
      const url = buildCrashReportUrl(ctx);
      void shell.openExternal(url).catch(() => {
        // catch-no-log-ok openExternal failure; crash already logged by caller
      });
      return true;
    }
  } catch {
    // catch-no-log-ok dialog unavailable during early startup or after app quit
  }

  return false;
}

/** Reset cooldown timer (exported for testing only). */
export function resetCrashDialogCooldownForTests(): void {
  lastCrashDialogAt = 0;
}
