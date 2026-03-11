import type { BrowserWindow } from 'electron';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const LOG_FILENAME = 'meshtastic-client.log';
const MAX_LINE_LENGTH = 8192;
const MAX_IPC_MESSAGE_LENGTH = 4096;
const RECENT_MAX = 1500;

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
    original.debug('[log-service] initLogFile truncate failed', e);
  }
  flushPendingBuffer();
}

function flushPendingBuffer(): void {
  if (pendingBuffer.length === 0) return;
  const lines = pendingBuffer.splice(0, pendingBuffer.length);
  const p = getLogFilePath();
  const data = lines.join('');
  appendChain = appendChain.then(() =>
    fs.promises.appendFile(p, data, 'utf8').catch((e) => {
      original.debug('[log-service] flushPendingBuffer appendFile failed', e);
    }),
  );
}

function formatLine(ts: number, level: LogLevel, source: string, message: string): string {
  const safe = message.length > MAX_LINE_LENGTH ? message.slice(0, MAX_LINE_LENGTH) + '…' : message;
  return `${new Date(ts).toISOString()} [${level}] [${source}] ${safe}\n`;
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

export function appendLine(level: LogLevel, source: string, message: string): void {
  const ts = Date.now();
  pushRecent(ts, level, source, message);
  const line = formatLine(ts, level, source, message);

  if (!logFilePath) {
    pendingBuffer.push(line);
    broadcastLine(ts, level, source, message);
    return;
  }

  appendChain = appendChain
    .then(() => fs.promises.appendFile(getLogFilePath(), line, 'utf8'))
    .catch((e) => {
      original.debug('[log-service] appendFile failed, retry writeFileSync', e);
      try {
        fs.writeFileSync(getLogFilePath(), line, { encoding: 'utf8' });
      } catch (e2) {
        original.debug('[log-service] writeFileSync retry failed', e2);
      }
    });

  broadcastLine(ts, level, source, message);
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
    original.debug('[log-service] broadcastLine send failed', e);
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
    original.debug('[log-service] clearLogFile unlink failed', e);
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

function stringifyArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack ?? a.message;
      if (typeof a === 'object' && a !== null) {
        try {
          return JSON.stringify(a);
        } catch (e) {
          original.debug('[log-service] stringifyArgs JSON.stringify failed', e);
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');
}

let consolePatched = false;

/**
 * Route main-process console.* through appendLine and still echo to original console
 * so terminal/devtools behavior is preserved.
 */
export function patchMainConsole(): void {
  if (consolePatched) return;
  consolePatched = true;

  console.log = (...args: unknown[]) => {
    appendLine('log', 'main', stringifyArgs(args));
    original.log(...args);
  };
  console.info = (...args: unknown[]) => {
    appendLine('info', 'main', stringifyArgs(args));
    original.info(...args);
  };
  console.warn = (...args: unknown[]) => {
    appendLine('warn', 'main', stringifyArgs(args));
    original.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    appendLine('error', 'main', stringifyArgs(args));
    original.error(...args);
  };
  console.debug = (...args: unknown[]) => {
    appendLine('debug', 'main', stringifyArgs(args));
    original.debug(...args);
  };

  // Capture process.stdout/stderr text writes (some deps log without console.*)
  const patchStream = (stream: NodeJS.WriteStream, level: LogLevel, source: string) => {
    const origWrite = stream.write.bind(stream);
    stream.write = function (this: NodeJS.WriteStream, ...args: unknown[]): boolean {
      try {
        const chunk = args[0];
        if (typeof chunk === 'string') {
          const trimmed = chunk.replace(/\r?\n$/, '');
          if (trimmed) appendLine(level, source, trimmed);
        }
      } catch (e) {
        original.debug('[log-service] patchStream write hook', e);
      }
      return origWrite.apply(this, args as Parameters<typeof origWrite>);
    } as typeof stream.write;
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
  const src = details.sourceId ? `renderer:${path.basename(details.sourceId)}:${line}` : 'renderer';
  appendLine(mapped, src, details.message);
}
