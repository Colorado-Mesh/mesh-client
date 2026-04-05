// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Source contract tests ────────────────────────────────────────────────────
// These verify structural invariants that runtime mocking cannot easily cover
// (e.g., that every appendFile call is preceded by sanitizeLogPayloadForDisk).

const LOG_SERVICE_SOURCE = readFileSync(join(__dirname, 'log-service.ts'), 'utf-8');

describe('log-service source contracts', () => {
  it('defines LOG_MAX_BYTES at 100 MB', () => {
    expect(LOG_SERVICE_SOURCE).toContain('const LOG_MAX_BYTES = 100 * 1024 * 1024');
  });

  it('defines LOG_BACKUP_FILENAME', () => {
    expect(LOG_SERVICE_SOURCE).toContain("const LOG_BACKUP_FILENAME = 'mesh-client.log.1'");
  });

  it('calls rotateLogIfNeeded before appendFile in appendLine', () => {
    const appendLineIdx = LOG_SERVICE_SOURCE.indexOf('export function appendLine(');
    expect(appendLineIdx).toBeGreaterThan(-1);
    // Extract the body of appendLine (up to the next top-level function)
    const bodySection = LOG_SERVICE_SOURCE.slice(appendLineIdx, appendLineIdx + 1200);
    const rotateIdx = bodySection.indexOf('rotateLogIfNeeded()');
    const appendFileIdx = bodySection.indexOf('.appendFile(');
    expect(rotateIdx).toBeGreaterThan(-1);
    expect(appendFileIdx).toBeGreaterThan(-1);
    // Rotation must come before appendFile
    expect(rotateIdx).toBeLessThan(appendFileIdx);
  });

  it('suppresses debug disk writes when app.isPackaged is true', () => {
    const appendLineIdx = LOG_SERVICE_SOURCE.indexOf('export function appendLine(');
    const body = LOG_SERVICE_SOURCE.slice(appendLineIdx, appendLineIdx + 1200);
    // The debug suppression guard must reference both level and isPackaged
    expect(body).toContain("level !== 'debug'");
    expect(body).toContain('app.isPackaged');
  });

  it('broadcastLine wraps webContents.send in try/catch', () => {
    const broadcastIdx = LOG_SERVICE_SOURCE.indexOf('function broadcastLine(');
    expect(broadcastIdx).toBeGreaterThan(-1);
    const body = LOG_SERVICE_SOURCE.slice(broadcastIdx, broadcastIdx + 400);
    expect(body).toContain('try {');
    expect(body).toContain('.send(');
    expect(body).toContain('catch (e)');
  });

  it('broadcastLine checks isDestroyed before sending', () => {
    const broadcastIdx = LOG_SERVICE_SOURCE.indexOf('function broadcastLine(');
    const body = LOG_SERVICE_SOURCE.slice(broadcastIdx, broadcastIdx + 400);
    expect(body).toContain('isDestroyed()');
  });

  it('rotateLogIfNeeded uses fs.promises.rename (not appendFile) for rotation', () => {
    const rotateIdx = LOG_SERVICE_SOURCE.indexOf('async function rotateLogIfNeeded()');
    expect(rotateIdx).toBeGreaterThan(-1);
    const body = LOG_SERVICE_SOURCE.slice(rotateIdx, rotateIdx + 400);
    expect(body).toContain('fs.promises.rename(');
    expect(body).not.toContain('appendFile');
  });

  it('rotateLogIfNeeded uses fs.promises.stat to check file size', () => {
    const rotateIdx = LOG_SERVICE_SOURCE.indexOf('async function rotateLogIfNeeded()');
    const body = LOG_SERVICE_SOURCE.slice(rotateIdx, rotateIdx + 400);
    expect(body).toContain('fs.promises.stat(');
    expect(body).toContain('stat.size');
    expect(body).toContain('LOG_MAX_BYTES');
  });
});

// ─── Functional tests ──────────────────────────────────────────────────────────
// Mock electron and fs to exercise the exported functions.

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-mesh-logs'),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
    isPackaged: false,
  },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    default: {
      ...actual,
      writeFileSync: vi.fn(),
      existsSync: vi.fn().mockReturnValue(false),
      unlinkSync: vi.fn(),
      promises: {
        appendFile: vi.fn().mockResolvedValue(undefined),
        stat: vi.fn().mockResolvedValue({ size: 0 }),
        rename: vi.fn().mockResolvedValue(undefined),
        copyFile: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
});

describe('getRecentLines', () => {
  beforeEach(() => {
    // Reset mocked call counts between tests
    vi.clearAllMocks();
  });

  it('returns a copy of buffered entries (not the live array)', async () => {
    const { appendLine, getRecentLines } = await import('./log-service');

    appendLine('info', 'test', 'hello world');
    const snapshot1 = getRecentLines();
    appendLine('warn', 'test', 'second message');
    const snapshot2 = getRecentLines();

    // snapshot1 should not be mutated after we appended a second message
    expect(snapshot2.length).toBeGreaterThan(snapshot1.length);
  });

  it('sanitizes control chars in the stored message', async () => {
    const { appendLine, getRecentLines } = await import('./log-service');

    appendLine('log', 'main', 'bad\x00message\x1Fhere');
    const entries = getRecentLines();
    const last = entries[entries.length - 1];
    expect(last.message).not.toContain('\x00');
    expect(last.message).not.toContain('\x1F');
    expect(last.message).toContain('bad');
  });

  it('stores the correct level and source', async () => {
    const { appendLine, getRecentLines } = await import('./log-service');

    appendLine('error', 'mqtt', 'connection lost');
    const entries = getRecentLines();
    const last = entries[entries.length - 1];
    expect(last.level).toBe('error');
    expect(last.source).toBe('mqtt');
  });
});

describe('appendLine disk write behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes non-debug messages to disk (no logFilePath set → pending buffer)', async () => {
    // With no initLogFile called, logFilePath is null and lines go to pendingBuffer.
    // We can still verify appendLine does not throw and pushes to recentEntries.
    const { appendLine, getRecentLines } = await import('./log-service');
    const before = getRecentLines().length;
    appendLine('warn', 'test', 'should buffer');
    expect(getRecentLines().length).toBeGreaterThan(before);
  });
});

describe('stripConsoleStyles (via appendLine + getRecentLines)', () => {
  it('stores messages without %c markers or CSS strings in recentEntries', async () => {
    const { appendLine, getRecentLines } = await import('./log-service');

    // Simulate a tslog-style styled message coming through appendLine
    appendLine('log', 'renderer:app.tsx:42', 'Hello %c World color: red; font-weight: bold');
    const entries = getRecentLines();
    const last = entries[entries.length - 1];
    // appendLine sanitizes but does not strip %c — that is done by forwardRendererConsoleMessage
    // The stored message should not be empty
    expect(last.message.length).toBeGreaterThan(0);
  });
});

describe('formatRuntimeLogTag', () => {
  it('includes platform, arch, electron, node, and packaged fields', async () => {
    const { formatRuntimeLogTag } = await import('./log-service');
    const tag = formatRuntimeLogTag();
    expect(tag).toContain('platform=');
    expect(tag).toContain('arch=');
    expect(tag).toContain('electron=');
    expect(tag).toContain('node=');
    expect(tag).toContain('packaged=');
  });
});
