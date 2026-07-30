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
import { app, dialog, shell } from 'electron';
import { release as osRelease } from 'node:os';

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
  const msg = ctx.error instanceof Error ? ctx.error.message : String(ctx.error);
  const cleaned = sanitizeLogMessage(msg).replace(/\n/g, ' ').slice(0, 80);
  return `[Crash] ${cleaned}`;
}

function formatErrorForBody(ctx: CrashContext): string {
  const msg = ctx.error instanceof Error ? ctx.error.message : String(ctx.error);
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
    sanitizeLogMessage(msg),
    '```',
    '',
    '**Stack trace:**',
    '```',
    sanitizeLogMessage(stack),
    '```',
    '',
    '---',
    '',
    '**Diagnostic bundle:**',
    'Please also attach the zip from **App → Support / Bug reports → Export for GitHub** if the app is still responsive.',
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
 * Truncates body if the URL exceeds safe browser limits.
 */
export function buildCrashReportUrl(ctx: CrashContext): string {
  const title = formatErrorForTitle(ctx);
  let body = formatErrorForBody(ctx);

  const baseUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/new`;
  const params = new URLSearchParams({
    template: ISSUE_TEMPLATE,
    title,
    body,
  });

  let url = `${baseUrl}?${params.toString()}`;

  if (url.length > MAX_URL_LENGTH) {
    const overhead = url.length - body.length;
    const maxBody = MAX_URL_LENGTH - overhead - 100;
    body =
      body.slice(0, maxBody) + '\n\n_(truncated — attach Export for GitHub zip for full details)_';
    const truncatedParams = new URLSearchParams({
      template: ISSUE_TEMPLATE,
      title,
      body,
    });
    url = `${baseUrl}?${truncatedParams.toString()}`;
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

  const msg = ctx.error instanceof Error ? ctx.error.message : String(ctx.error);
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
