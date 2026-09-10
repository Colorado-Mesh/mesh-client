/**
 * crash-report-dialog.ts
 *
 * On an unhandled exception/rejection, offers to open a pre-filled GitHub issue
 * so users can report crashes without any backend, telemetry, or tokens.
 *
 * Consent model (opt-in, nothing is sent automatically):
 *   1. Crash notice  — "An unexpected error occurred." with Report / Dismiss.
 *   2. Consent step  — before anything leaves the app, an explicit dialog lists
 *      exactly what the pre-filled issue will contain (crash source, OS + arch,
 *      app version, packaged flag, error message, stack trace). The user chooses
 *      to allow once, always allow (persisted), or cancel.
 *   3. Open browser  — only after consent, the user's browser opens on the
 *      GitHub "new issue" page with the fields pre-filled. The user still has to
 *      review and submit the issue themselves; the app never transmits anything.
 *
 * Sync API note: the process-level `uncaughtException` / `unhandledRejection`
 * handlers are synchronous and may exit right after, so this uses
 * `dialog.showMessageBoxSync`. That call returns only a button index — the
 * checkbox state from `checkboxLabel` is not available synchronously — so the
 * "remember my choice" preference is captured as an explicit button instead of a
 * checkbox.
 */
import { release as osRelease } from 'node:os';

import { app, dialog, shell } from 'electron';

import { getDatabase } from './database';
import { sanitizeLogMessage } from './log-service';

const REPO_OWNER = 'Colorado-Mesh';
const REPO_NAME = 'mesh-client';
const ISSUE_TEMPLATE = 'crash_report.md';

/** Max URL length safe for most browsers and GitHub's server (practical limit ~8192). */
const MAX_URL_LENGTH = 8000;
/** Max stack trace chars to include in the issue body. */
const MAX_STACK_LENGTH = 1500;
/** Max error message chars shown in the dialog detail. */
const MAX_DETAIL_MESSAGE_LENGTH = 500;

/**
 * `app_settings` key persisting a granted "always report" consent.
 * Stored only when the user explicitly chooses "Always allow".
 */
export const CRASH_REPORT_CONSENT_SETTING_KEY = 'crashReportConsent';
const CONSENT_GRANTED_VALUE = 'granted';

export interface CrashContext {
  /** 'uncaughtException' | 'unhandledRejection' | 'render-process-gone' */
  source: string;
  error: Error | string;
}

/** Outcome of the consent step. */
type ConsentDecision = 'once' | 'always' | 'cancel';

function getAppVersion(): string {
  try {
    return app.getVersion();
  } catch {
    // catch-no-log-ok app not ready during very early crash
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

function errorMessageOf(ctx: CrashContext): string {
  return ctx.error instanceof Error ? ctx.error.message : ctx.error;
}

/**
 * Read a previously granted "always report" consent from `app_settings`.
 * Returns false (and never throws) if the DB is unavailable, which is likely
 * during an early-startup crash.
 */
export function hasStoredCrashReportConsent(): boolean {
  try {
    const row = getDatabase()
      .prepareOnce('SELECT value FROM app_settings WHERE key = ?')
      .get(CRASH_REPORT_CONSENT_SETTING_KEY) as { value: string } | undefined;
    return row?.value === CONSENT_GRANTED_VALUE;
  } catch {
    // catch-no-log-ok DB read during early startup / crash
    return false;
  }
}

/** Persist a granted "always report" consent. Best-effort; never throws. */
function storeCrashReportConsent(): void {
  try {
    getDatabase()
      .prepareOnce('INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)')
      .run(CRASH_REPORT_CONSENT_SETTING_KEY, CONSENT_GRANTED_VALUE);
  } catch {
    // catch-no-log-ok DB write during crash; consent simply falls back to per-crash
  }
}

function formatErrorForTitle(ctx: CrashContext): string {
  // Keep title concise — collapse newlines and truncate to 80 chars.
  const cleaned = sanitizeLogMessage(errorMessageOf(ctx)).replace(/\s+/g, ' ').slice(0, 80);
  return `[Crash] ${cleaned}`;
}

/** Human-readable list of exactly what the report will include (for the consent dialog). */
export function describeReportContents(ctx: CrashContext): string {
  const platform = getPlatformLabel();
  const packaged = app.isPackaged ? 'yes' : 'no (dev)';
  return [
    'Reporting opens your web browser on a new GitHub issue with these details filled in:',
    '',
    `• Crash source: ${ctx.source}`,
    `• Operating system: ${platform} ${osRelease()} (${process.arch})`,
    `• App version: ${getAppVersion()} (packaged: ${packaged})`,
    '• Error message and stack trace',
    '',
    'No logs, message content, identities, or database contents are included, and',
    'nothing is sent automatically — you review and submit the issue yourself.',
  ].join('\n');
}

function formatErrorForBody(ctx: CrashContext): string {
  const msg = errorMessageOf(ctx);
  const stack =
    ctx.error instanceof Error && ctx.error.stack
      ? ctx.error.stack.slice(0, MAX_STACK_LENGTH)
      : '(no stack trace)';

  const platform = getPlatformLabel();
  const packaged = app.isPackaged ? 'yes' : 'no (dev)';

  return [
    '**Crash source:** `' + ctx.source + '`',
    '',
    '**Desktop:**',
    `- OS: ${platform} ${osRelease()} (${process.arch})`,
    `- App version: ${getAppVersion()}`,
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
 * Falls back gracefully if the URL exceeds browser limits by trimming the body.
 */
export function buildCrashReportUrl(ctx: CrashContext): string {
  const title = formatErrorForTitle(ctx);
  let body = formatErrorForBody(ctx);

  const baseUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/new`;
  const buildUrl = (b: string): string => {
    const params = new URLSearchParams({ template: ISSUE_TEMPLATE, title, body: b });
    return `${baseUrl}?${params.toString()}`;
  };

  let url = buildUrl(body);
  if (url.length <= MAX_URL_LENGTH) {
    return url;
  }

  // Too long: append a truncation notice, then shrink the body until the fully
  // encoded URL fits. Encoding can expand characters (a space becomes `+`, a
  // newline `%0A`), so estimate then verify rather than trusting a char count.
  const notice = '\n\n_(truncated — attach Export for GitHub zip for full details)_';
  const overhead = url.length - buildUrl('').length; // encoded, minus the body
  let keep = Math.max(0, MAX_URL_LENGTH - overhead - notice.length * 3);
  do {
    body = body.slice(0, keep) + notice;
    url = buildUrl(body);
    keep = Math.max(0, keep - 200);
  } while (url.length > MAX_URL_LENGTH && keep > 0);

  return url;
}

/**
 * Cooldown tracking — don't show the crash report dialog more than once per 60s.
 * Mirrors the previous inline `lastUnhandledRejectionDialogAt` throttle.
 */
let lastCrashDialogAt = 0;
const CRASH_DIALOG_COOLDOWN_MS = 60_000;

/** Reset the cooldown. Test-only helper. */
export function resetCrashReportCooldownForTests(): void {
  lastCrashDialogAt = 0;
}

/**
 * Consent step: shows exactly what will be included and asks for permission.
 * Returns the user's decision. Any dialog failure is treated as 'cancel'.
 */
function requestReportConsent(ctx: CrashContext): ConsentDecision {
  try {
    const response = dialog.showMessageBoxSync({
      type: 'question',
      title: 'Mesh-Client — Send a crash report?',
      message: 'Report this crash on GitHub?',
      detail: describeReportContents(ctx),
      buttons: ['Always allow', 'Allow once', 'Cancel'],
      defaultId: 1,
      cancelId: 2,
      noLink: true,
    });
    if (response === 0) return 'always';
    if (response === 1) return 'once';
    return 'cancel';
  } catch {
    // catch-no-log-ok dialog unavailable; treat as no consent
    return 'cancel';
  }
}

/**
 * Show the crash dialog and, with consent, open a pre-filled GitHub issue.
 *
 * Flow:
 *  - 60s cooldown suppresses repeats from tight error loops.
 *  - Crash notice offers Report / Dismiss.
 *  - If the user chooses Report and has not previously granted "always",
 *    an explicit consent dialog lists the exact data included.
 *  - Only after consent does the browser open. Nothing is sent by the app.
 *
 * Returns true if a report URL was opened.
 */
export function showCrashReportDialog(ctx: CrashContext): boolean {
  const now = Date.now();
  if (now - lastCrashDialogAt < CRASH_DIALOG_COOLDOWN_MS) {
    return false;
  }
  lastCrashDialogAt = now;

  const detail = [
    `Source: ${ctx.source}`,
    '',
    sanitizeLogMessage(errorMessageOf(ctx)).slice(0, MAX_DETAIL_MESSAGE_LENGTH),
    '',
    'You can report this crash on GitHub to help us fix it.',
  ].join('\n');

  let userWantsToReport: boolean;
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
    userWantsToReport = response === 0;
  } catch {
    // catch-no-log-ok dialog unavailable during early startup or after app quit
    return false;
  }

  if (!userWantsToReport) {
    return false;
  }

  // Consent gate: skip if the user previously chose "always allow".
  if (!hasStoredCrashReportConsent()) {
    const decision = requestReportConsent(ctx);
    if (decision === 'cancel') {
      return false;
    }
    if (decision === 'always') {
      storeCrashReportConsent();
    }
  }

  const url = buildCrashReportUrl(ctx);
  void shell.openExternal(url).catch(() => {
    // catch-no-log-ok openExternal failed; crash already logged by the caller
  });
  return true;
}
