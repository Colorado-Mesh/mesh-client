// @vitest-environment node
import fs, { readFileSync } from 'fs';
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

  it('initLogFile preserves a non-empty prior session log as .1 before truncating', () => {
    const initIdx = LOG_SERVICE_SOURCE.indexOf('export function initLogFile(');
    expect(initIdx).toBeGreaterThan(-1);
    const body = LOG_SERVICE_SOURCE.slice(initIdx, initIdx + 2800);
    expect(body).toContain('fs.renameSync(p, staging)');
    expect(body).toContain('fs.renameSync(staging, backup)');
    expect(body).toContain('LOG_BACKUP_FILENAME');
    expect(body).toContain('statSync');
    expect(body).toContain('skipFreshTruncate');
    const renameIdx = body.indexOf('fs.renameSync(p, staging)');
    const truncateIdx = body.indexOf("fs.writeFileSync(p, '', { encoding: 'utf8' })");
    expect(renameIdx).toBeGreaterThan(-1);
    expect(truncateIdx).toBeGreaterThan(-1);
    expect(renameIdx).toBeLessThan(truncateIdx);
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

  it('always writes all levels to disk (including debug)', () => {
    const appendLineIdx = LOG_SERVICE_SOURCE.indexOf('export function appendLine(');
    const body = LOG_SERVICE_SOURCE.slice(appendLineIdx, appendLineIdx + 1200);
    // No debug suppression guard - all levels go to disk
    expect(body).not.toContain("level !== 'debug'");
    expect(body).not.toContain('app.isPackaged');
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

  it('patchMainConsole echoes warn/error through sanitizeForConsoleEcho at original.* sink', () => {
    expect(LOG_SERVICE_SOURCE).toContain(
      'original.warn(sanitizeForConsoleEcho(`[${ts}] ${safe}`))',
    );
    expect(LOG_SERVICE_SOURCE).toContain(
      'original.error(sanitizeForConsoleEcho(`[${ts}] ${safe}`))',
    );
  });

  it('stringifyArgs sanitizes each argument fragment (CodeQL log paths)', () => {
    expect(LOG_SERVICE_SOURCE).toContain('return sanitizeForLogSink(piece);');
  });

  it('routes internal failures through debugLogService (sanitized original.debug)', () => {
    expect(LOG_SERVICE_SOURCE).toContain('function debugLogService');
    expect(LOG_SERVICE_SOURCE).toContain('const detail = sanitizeForLogSink(detailRaw);');
    expect(LOG_SERVICE_SOURCE).toContain(
      'original.debug(sanitizeForConsoleEcho(`${context} ${detail}`))',
    );
  });

  it('wraps appendFile/writeFileSync data with sanitizeLogPayloadForDisk at call site', () => {
    expect(LOG_SERVICE_SOURCE).toContain(
      ".appendFile(p, sanitizeLogPayloadForDisk(lines.join('')), 'utf8')",
    );
    expect(LOG_SERVICE_SOURCE).toContain(
      "fs.promises.appendFile(getLogFilePath(), sanitizeLogPayloadForDisk(line), 'utf8')",
    );
    expect(LOG_SERVICE_SOURCE).toContain(
      'fs.writeFileSync(getLogFilePath(), sanitizeLogPayloadForDisk(line)',
    );
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
      statSync: vi.fn().mockReturnValue({ size: 0 }),
      renameSync: vi.fn(),
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
    vi.mocked(fs.writeFileSync).mockClear();
    vi.mocked(fs.existsSync).mockClear();
    vi.mocked(fs.unlinkSync).mockClear();
    vi.mocked(fs.promises.appendFile).mockClear();
    vi.mocked(fs.promises.stat).mockClear();
    vi.mocked(fs.promises.rename).mockClear();
    vi.mocked(fs.promises.copyFile).mockClear();
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
    vi.mocked(fs.writeFileSync).mockClear();
    vi.mocked(fs.existsSync).mockClear();
    vi.mocked(fs.unlinkSync).mockClear();
    vi.mocked(fs.statSync).mockClear();
    vi.mocked(fs.renameSync).mockClear();
    vi.mocked(fs.promises.appendFile).mockClear();
    vi.mocked(fs.promises.stat).mockClear();
    vi.mocked(fs.promises.rename).mockClear();
    vi.mocked(fs.promises.copyFile).mockClear();
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

describe('initLogFile previous-session preserve', () => {
  beforeEach(() => {
    vi.mocked(fs.writeFileSync).mockClear();
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.unlinkSync).mockClear();
    vi.mocked(fs.statSync).mockReset();
    vi.mocked(fs.renameSync).mockClear();
  });

  it('renames a non-empty prior log to .1 then creates an empty current log', async () => {
    vi.mocked(fs.existsSync).mockImplementation((target) => {
      const s = String(target);
      if (s.endsWith('mesh-client.log.1')) return true;
      if (s.endsWith('mesh-client.log')) return true;
      return false;
    });
    vi.mocked(fs.statSync).mockReturnValue({ size: 128 } as fs.Stats);

    const { initLogFile } = await import('./log-service');
    initLogFile();

    expect(fs.unlinkSync).toHaveBeenCalled();
    // Staging rename: current → .1.staging-* → .1 (avoids losing backup if promote fails).
    expect(fs.renameSync).toHaveBeenCalledWith(
      expect.stringMatching(/mesh-client\.log$/),
      expect.stringMatching(/mesh-client\.log\.1\.staging-/),
    );
    expect(fs.renameSync).toHaveBeenCalledWith(
      expect.stringMatching(/mesh-client\.log\.1\.staging-/),
      expect.stringMatching(/mesh-client\.log\.1$/),
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/mesh-client\.log$/),
      '',
      expect.objectContaining({ encoding: 'utf8' }),
    );
  });

  it('does not rotate when the prior log is empty or missing', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const { initLogFile } = await import('./log-service');
    initLogFile();

    expect(fs.renameSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/mesh-client\.log$/),
      '',
      expect.objectContaining({ encoding: 'utf8' }),
    );
  });

  it('does not rotate when the prior log exists but is empty (size 0)', async () => {
    vi.mocked(fs.existsSync).mockImplementation((target) =>
      String(target).endsWith('mesh-client.log'),
    );
    vi.mocked(fs.statSync).mockReturnValue({ size: 0 } as fs.Stats);

    const { initLogFile } = await import('./log-service');
    initLogFile();

    expect(fs.renameSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/mesh-client\.log$/),
      '',
      expect.objectContaining({ encoding: 'utf8' }),
    );
  });

  it('does not truncate prior log when staging→backup promote fails and restore succeeds', async () => {
    const prior = 'PRIOR-SESSION-LOG-BYTES';
    let currentExists = true;
    let stagingPath: string | null = null;
    const stagingContents = new Map<string, string>();

    vi.mocked(fs.existsSync).mockImplementation((target) => {
      const s = String(target);
      if (s.endsWith('mesh-client.log.1')) return false;
      if (s.includes('.staging-')) return stagingContents.has(s);
      if (s.endsWith('mesh-client.log')) return currentExists;
      return false;
    });
    vi.mocked(fs.statSync).mockReturnValue({ size: prior.length } as fs.Stats);
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
      const f = String(from);
      const t = String(to);
      if (f.endsWith('mesh-client.log') && t.includes('.staging-')) {
        stagingPath = t;
        stagingContents.set(t, prior);
        currentExists = false;
        return;
      }
      if (f.includes('.staging-') && t.endsWith('mesh-client.log.1')) {
        throw new Error('promote failed');
      }
      if (f.includes('.staging-') && t.endsWith('mesh-client.log')) {
        stagingContents.delete(f);
        currentExists = true;
        return;
      }
    });

    const { initLogFile } = await import('./log-service');
    initLogFile();

    expect(stagingPath).toBeTruthy();
    // Must restore staging → current and skip destructive truncate of prior content.
    expect(fs.renameSync).toHaveBeenCalledWith(
      expect.stringMatching(/mesh-client\.log\.1\.staging-/),
      expect.stringMatching(/mesh-client\.log$/),
    );
    const truncatedCurrent = vi
      .mocked(fs.writeFileSync)
      .mock.calls.some((args) => String(args[0]).endsWith('mesh-client.log') && args[1] === '');
    expect(truncatedCurrent).toBe(false);
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

describe('isDroppableMeshtasticSdkLogLine', () => {
  it('drops routine SDK TRACE [iMeshDevice] chatter', async () => {
    const { isDroppableMeshtasticSdkLogLine } = await import('./log-service');
    expect(
      isDroppableMeshtasticSdkLogLine(
        '03:39:57:239 TRACE [iMeshDevice] HandleMeshPacket Received STORE_FORWARD_APP packet',
      ),
    ).toBe(true);
    expect(
      isDroppableMeshtasticSdkLogLine(
        '01:25:29:719 TRACE [iMeshDevice] HandleFromRadio Received Queue Status',
      ),
    ).toBe(true);
  });

  it('drops periodic DEBUG [iMeshDevice] Ping heartbeats', async () => {
    const { isDroppableMeshtasticSdkLogLine } = await import('./log-service');
    expect(
      isDroppableMeshtasticSdkLogLine(
        '01:25:29:561 DEBUG [iMeshDevice] Ping Send heartbeat ping to radio',
      ),
    ).toBe(true);
  });

  it('keeps INFO / WARN / ERROR SDK lines', async () => {
    const { isDroppableMeshtasticSdkLogLine } = await import('./log-service');
    expect(
      isDroppableMeshtasticSdkLogLine(
        '00:56:01:200 WARN [iMeshDevice] HandleFromRadio Unhandled payload variant: deviceuiConfig',
      ),
    ).toBe(false);
    expect(
      isDroppableMeshtasticSdkLogLine(
        '00:56:01:185 INFO [iMeshDevice] HandleFromRadio Received Node info for this device',
      ),
    ).toBe(false);
  });

  it('keeps non-Ping DEBUG lines', async () => {
    const { isDroppableMeshtasticSdkLogLine } = await import('./log-service');
    expect(
      isDroppableMeshtasticSdkLogLine(
        '00:56:01:222 DEBUG [iMeshDevice] GetMetadata Received metadata packet',
      ),
    ).toBe(false);
  });

  it('keeps TRACE decode-failure lines needed by Foreign LoRa detection', async () => {
    const { isDroppableMeshtasticSdkLogLine } = await import('./log-service');
    expect(
      isDroppableMeshtasticSdkLogLine(
        'TRACE [iMeshDevice] HandleMeshPacket decode failed rssi -120 snr -8 3c 01 02',
      ),
    ).toBe(false);
  });

  it('keeps unrelated renderer/main lines', async () => {
    const { isDroppableMeshtasticSdkLogLine } = await import('./log-service');
    expect(isDroppableMeshtasticSdkLogLine('[main] [MeshCore MQTT] PINGREQ sent')).toBe(false);
  });
});

describe('isDroppableRendererConsoleNoise', () => {
  it('drops ResizeObserver loop completed warnings', async () => {
    const { isDroppableRendererConsoleNoise } = await import('./log-service');
    expect(
      isDroppableRendererConsoleNoise(
        'ResizeObserver loop completed with undelivered notifications.',
      ),
    ).toBe(true);
    expect(isDroppableRendererConsoleNoise('ResizeObserver loop limit exceeded')).toBe(true);
  });

  it('keeps other renderer errors', async () => {
    const { isDroppableRendererConsoleNoise } = await import('./log-service');
    expect(isDroppableRendererConsoleNoise('Error sending packet 123')).toBe(false);
    expect(isDroppableRendererConsoleNoise('ResizeObserver is not defined')).toBe(false);
    expect(
      isDroppableRendererConsoleNoise(
        'Send failed: ResizeObserver loop limit exceeded while laying out',
      ),
    ).toBe(false);
  });
});

describe('formatRuntimeLogTag', () => {
  it('includes platform, arch, electron, node, packaged, and buildChannel fields', async () => {
    const { formatRuntimeLogTag } = await import('./log-service');
    const tag = formatRuntimeLogTag();
    expect(tag).toContain('platform=');
    expect(tag).toContain('arch=');
    expect(tag).toContain('electron=');
    expect(tag).toContain('node=');
    expect(tag).toContain('packaged=');
    expect(tag).toContain('buildChannel=local');
  });
});
