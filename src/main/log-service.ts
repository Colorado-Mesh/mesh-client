import { release as osRelease } from 'node:os';

import type { BrowserWindow } from 'electron';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { formatLogFileTimestamp } from '../shared/formatLogTimestamp';
import {
  sanitizeForConsoleEcho,
  sanitizeForLogSink,
  sanitizeLogMessage,
  sanitizeLogPayloadForDisk,
} from './sanitize-log-message';

export { sanitizeLogMessage };

/** Compact OS/runtime fields for startup and per-device connection lines (main process). */
export function formatRuntimeLogTag(): string {
  const appVersion =
    typeof app !== 'undefined' && typeof app.getVersion === 'function'
      ? app.getVersion()
      : 'unknown';
  const packaged =
    typeof app !== 'undefined' && typeof app.isPackaged === 'boolean' ? app.isPackaged : false;
  return `platform=${process.platform} arch=${process.arch} os=${osRelease()} electron=${process.versions.electron} node=${process.versions.node} app=${appVersion} packaged=${packaged}`;
}

/**
 * One line per device connect: `[Connection] …` plus {@link formatRuntimeLogTag}.
 * Pass only trusted or pre-sanitized fragments in `detail`; the full line is sanitized again in {@link appendLine}.
 */
export function logDeviceConnection(detail: string): void {
  appendLine(
    'debug',
    'main',
    `[Connection] ${sanitizeLogMessage(detail)} ${formatRuntimeLogTag()}`,
  );
}

const LOG_FILENAME = 'mesh-client.log';
const LOG_BACKUP_FILENAME = 'mesh-client.log.1';
const LOG_MAX_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_LINE_LENGTH = 8192;
const MAX_IPC_MESSAGE_LENGTH = 4096;
const RECENT_MAX = 1500;

/**
 * Strip console %c style directives and their trailing CSS argument strings from messages
 * captured via Electron's console-message event. tslog (used by @meshtastic/core) emits
 * styled logs with %c markers; Chrome appends each CSS argument space-separated at the end
 * of the message string when it is serialized by the console-message event.
 */
function stripConsoleStyles(msg: string): string {
  if (!msg.includes('%c')) return msg;
  // Remove inline %c format specifiers
  const withoutMarkers = msg.replace(/%c/g, '');
  // Strip trailing CSS property declarations appended by Chrome's console-message serialization.
  // tslog uses: font-weight, color, background, padding, border-radius, font-style, text-decoration.
  return withoutMarkers
    .replace(
      /\s+(?:font-weight|font-style|color|background(?:-color)?|padding|border-radius|text-decoration)\s*:.*$/,
      '',
    )
    .trim();
}

interface LogEntry {
  ts: number;
  level: LogLevel;
  source: string;
  message: string;
}
const recentEntries: LogEntry[] = [];

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

let logFilePath: string | null = null;
let mainWindowRef: BrowserWindow | null = null;
const pendingBuffer: string[] = [];
let appendChain: Promise<void> = Promise.resolve();

function getLogFilePath(): string {
  if (!logFilePath) {
    logFilePath = path.join(app.getPath('userData'), LOG_FILENAME);
  }
  return logFilePath;
}

/**
 * Truncate log on app start; call from app.whenReady before other heavy init.
 */
export function initLogFile(): void {
  recentEntries.length = 0;
  const p = getLogFilePath();
  try {
    fs.writeFileSync(p, '', { encoding: 'utf8' });
  } catch (e) {
    debugLogService('[log-service] initLogFile truncate failed', e);
  }
  flushPendingBuffer();
}

function flushPendingBuffer(): void {
  if (pendingBuffer.length === 0) return;
  const lines = pendingBuffer.splice(0, pendingBuffer.length);
  const p = getLogFilePath();
  appendChain = appendChain.then(() =>
    fs.promises
      .appendFile(p, sanitizeLogPayloadForDisk(lines.join('')), 'utf8') // codeql[js/http-to-file-access] -- skip; sanitizeLogPayloadForDisk
      .catch((e: unknown) => {
        debugLogService('[log-service] flushPendingBuffer appendFile failed', e);
      }),
  );
}

/** Await pending log writes before process exit. Failure point: disk I/O; fallback: best-effort drain. */
export async function flushLogBeforeQuit(): Promise<void> {
  flushPendingBuffer();
  await appendChain;
}

function formatLine(ts: number, level: LogLevel, source: string, message: string): string {
  const safe = message.length > MAX_LINE_LENGTH ? message.slice(0, MAX_LINE_LENGTH) + '…' : message;
  return `${formatLogFileTimestamp(ts)} [${level}] [${source}] ${safe}\n`;
}

/**
 * Append a line to the log file and broadcast to renderer.
 * All levels are recorded; UI filters by level.
 */
function pushRecent(ts: number, level: LogLevel, source: string, message: string): void {
  let msg = message;
  if (msg.length > MAX_IPC_MESSAGE_LENGTH) {
    msg = msg.slice(0, MAX_IPC_MESSAGE_LENGTH) + '…';
  }
  recentEntries.push({ ts, level, source, message: msg });
  if (recentEntries.length > RECENT_MAX) {
    recentEntries.splice(0, recentEntries.length - RECENT_MAX);
  }
}

/**
 * Return buffered lines for UI replay (subscriber missed fire-and-forget sends).
 */
export function getRecentLines(): LogEntry[] {
  return recentEntries.slice();
}

/**
 * Append one log line to the on-disk log and to the renderer. Every message is passed through
 * {@link sanitizeLogMessage} first so renderer IPC, stdout/stderr hooks, and main console
 * all persist single-line, control-char-free entries (GitHub/CodeQL untrusted-to-file guidance).
 */
export function appendLine(level: LogLevel, source: string, message: string): void {
  message = sanitizeLogMessage(message);
  // Source is embedded in the log line; sanitize so the whole line is control-char-free.
  source = sanitizeLogMessage(source);
  const ts = Date.now();
  pushRecent(ts, level, source, message);
  const line = formatLine(ts, level, source, message);

  if (!logFilePath) {
    pendingBuffer.push(line);
    broadcastLine(ts, level, source, message);
    return;
  }

  appendChain = appendChain
    .then(() => rotateLogIfNeeded())
    .then(
      () => fs.promises.appendFile(getLogFilePath(), sanitizeLogPayloadForDisk(line), 'utf8'), // codeql[js/http-to-file-access] -- skip; sanitizeLogPayloadForDisk
    )
    .catch((e: unknown) => {
      debugLogService('[log-service] appendFile failed, retry writeFileSync', e);
      try {
        fs.writeFileSync(getLogFilePath(), sanitizeLogPayloadForDisk(line), {
          // codeql[js/http-to-file-access] -- skip; sanitizeLogPayloadForDisk
          encoding: 'utf8',
        });
      } catch (e2) {
        debugLogService('[log-service] writeFileSync retry failed', e2);
      }
    });

  broadcastLine(ts, level, source, message);
}

async function rotateLogIfNeeded(): Promise<void> {
  const p = getLogFilePath();
  try {
    const stat = await fs.promises.stat(p);
    if (stat.size >= LOG_MAX_BYTES) {
      const backup = path.join(path.dirname(p), LOG_BACKUP_FILENAME);
      await fs.promises.rename(p, backup);
    }
  } catch {
    // catch-no-log-ok: stat throws when the file doesn't exist yet; rotation skipped
  }
}

function broadcastLine(ts: number, level: LogLevel, source: string, message: string): void {
  const win = mainWindowRef;
  if (!win || win.isDestroyed()) return;
  let msg = message;
  if (msg.length > MAX_IPC_MESSAGE_LENGTH) {
    msg = msg.slice(0, MAX_IPC_MESSAGE_LENGTH) + '…';
  }
  try {
    win.webContents.send('log:line', { ts, level, source, message: msg });
  } catch (e) {
    debugLogService('[log-service] broadcastLine send failed', e);
  }
}

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
}

export function getLogPath(): string {
  return getLogFilePath();
}

export async function exportLogTo(destPath: string): Promise<void> {
  const src = getLogFilePath();
  await fs.promises.copyFile(src, destPath);
}

export function clearLogFile(): void {
  const p = getLogFilePath();
  try {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  } catch (e) {
    debugLogService('[log-service] clearLogFile unlink failed', e);
  }
}

// ─── Console patching (main process) ───────────────────────────────
const original = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

/** Single-line debug echo with CodeQL-visible sanitization (js/log-injection). */
function debugLogService(context: string, err: unknown): void {
  const detailRaw = err instanceof Error ? (err.stack ?? err.message) : String(err);
  const detail = sanitizeForLogSink(detailRaw);
  original.debug(sanitizeForConsoleEcho(`${context} ${detail}`));
}

function stringifyArgs(args: unknown[]): string {
  return args
    .map((a) => {
      let piece: string;
      if (a instanceof Error) piece = a.stack ?? a.message;
      else if (typeof a === 'object' && a !== null) {
        try {
          piece = JSON.stringify(a);
        } catch (e) {
          debugLogService('[log-service] stringifyArgs JSON.stringify failed', e);
          piece = '[unserializable]';
        }
      } else {
        piece = String(a);
      }
      return sanitizeForLogSink(piece);
    })
    .join(' ');
}

let consolePatched = false;

function resolveMainSource(): 'sdk' | 'main' {
  const stack = new Error().stack ?? '';
  return stack.includes('node_modules/@meshtastic') ? 'sdk' : 'main';
}

/**
 * Route main-process console.* through appendLine and still echo to original console
 * so terminal/devtools behavior is preserved.
 * Disk / UI lines use {@link sanitizeForLogSink}; terminal echo uses {@link sanitizeForConsoleEcho}
 * so CodeQL's newline StringReplaceSanitizer applies at console sinks.
 */
export function patchMainConsole(): void {
  if (consolePatched) return;
  consolePatched = true;

  console.log = (...args: unknown[]) => {
    const joined = stringifyArgs(args);
    const safe = sanitizeForLogSink(joined);
    appendLine('log', resolveMainSource(), safe);
    original.log(sanitizeForConsoleEcho(joined));
  };
  console.info = (...args: unknown[]) => {
    const joined = stringifyArgs(args);
    const safe = sanitizeForLogSink(joined);
    appendLine('info', resolveMainSource(), safe);
    original.info(sanitizeForConsoleEcho(joined));
  };
  console.warn = (...args: unknown[]) => {
    const joined = stringifyArgs(args);
    const safe = sanitizeForLogSink(joined);
    appendLine('warn', resolveMainSource(), safe);
    const ts = formatLogFileTimestamp(Date.now());
    original.warn(sanitizeForConsoleEcho(`[${ts}] ${safe}`));
  };
  console.error = (...args: unknown[]) => {
    const joined = stringifyArgs(args);
    const safe = sanitizeForLogSink(joined);
    appendLine('error', resolveMainSource(), safe);
    const ts = formatLogFileTimestamp(Date.now());
    original.error(sanitizeForConsoleEcho(`[${ts}] ${safe}`));
  };
  console.debug = (...args: unknown[]) => {
    const joined = stringifyArgs(args);
    const safe = sanitizeForLogSink(joined);
    appendLine('debug', resolveMainSource(), safe);
  };

  // Capture process.stdout/stderr text writes (some deps log without console.*)
  const patchStream = (stream: NodeJS.WriteStream, level: LogLevel, source: string) => {
    const origWrite = stream.write.bind(stream);
    stream.write = function (this: NodeJS.WriteStream, ...args: unknown[]): boolean {
      try {
        const chunk = args[0];
        if (typeof chunk === 'string') {
          const trimmed = chunk.replace(/\r?\n$/, '');
          if (trimmed) appendLine(level, source, sanitizeLogMessage(trimmed));
        }
      } catch (e) {
        debugLogService('[log-service] patchStream write hook', e);
      }
      return origWrite.apply(this, args as Parameters<typeof origWrite>);
    };
  };
  patchStream(process.stdout, 'log', 'stdout');
  patchStream(process.stderr, 'warn', 'stderr');
}

/**
 * Renderer console-message (Electron 40+): single event object with message, level, lineNumber, sourceId.
 * level is 'info' | 'warning' | 'error' | 'debug'.
 */
export function forwardRendererConsoleMessage(details: {
  message: string;
  level: 'info' | 'warning' | 'error' | 'debug';
  lineNumber: number;
  sourceId: string;
}): void {
  const levelMap: Record<string, LogLevel> = {
    info: 'log',
    warning: 'warn',
    error: 'error',
    debug: 'debug',
  };
  const mapped: LogLevel = levelMap[details.level] ?? 'log';
  const line = details.lineNumber;
  const src = details.sourceId
    ? sanitizeLogMessage(`renderer:${path.basename(details.sourceId)}:${line}`)
    : 'renderer';
  const msg = sanitizeLogMessage(stripConsoleStyles(details.message));
  appendLine(mapped, src, msg);
}
