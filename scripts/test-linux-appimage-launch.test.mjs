import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { EM_AARCH64, EM_X86_64 } from './test-linux-appimage-reticulum-sidecar.mjs';
import {
  LOG_FILENAME,
  LaunchSmokeError,
  buildLaunchArgs,
  buildLaunchEnv,
  launchAndAssert,
  logShowsRendererFailure,
  logShowsStartup,
  shouldLaunchOnHost,
} from './test-linux-appimage-launch.mjs';

/** Build a minimal ELF header with the given e_machine for an AppImage fixture. */
function writeElfAppImage(dir, name, machine) {
  const header = Buffer.alloc(64);
  header[0] = 0x7f;
  header[1] = 0x45; // E
  header[2] = 0x4c; // L
  header[3] = 0x46; // F
  header.writeUInt16LE(machine, 18);
  const filePath = path.join(dir, name);
  writeFileSync(filePath, header);
  return filePath;
}

/** On-disk shape from log-service formatLine: `[level] [source] message`. */
const RENDERER_URL_LINE =
  '2026-01-01T00:00:00.000Z [debug] [main] [Startup] renderer URL: file:///app/index.html';
const RENDERER_SOURCE_LINE = '2026-01-01T00:00:00.000Z [log] [renderer:index.js:12] ready';
const MAIN_ONLY_LINE = '2026-01-01T00:00:00.000Z [error] [main] [main] crashReporter started';

describe('logShowsStartup', () => {
  it('accepts the renderer URL line logged just before loadURL', () => {
    expect(logShowsStartup(RENDERER_URL_LINE)).toBe(true);
    expect(logShowsStartup(`noise\n${RENDERER_URL_LINE}\n`)).toBe(true);
  });

  it('accepts a renderer-source line once the page is running', () => {
    expect(logShowsStartup(RENDERER_SOURCE_LINE)).toBe(true);
    expect(logShowsStartup('2026-01-01T00:00:00.000Z [log] [renderer] ready')).toBe(true);
  });

  it('rejects bare main-process lines, including errors', () => {
    // formatLine tags every main line [level] [main], so [main] alone is not a boot.
    expect(logShowsStartup(MAIN_ONLY_LINE)).toBe(false);
    expect(logShowsStartup('2026-01-01T00:00:00.000Z [debug] [main] initialized')).toBe(false);
    expect(logShowsStartup('')).toBe(false);
  });

  it('returns false for non-string input', () => {
    // @ts-expect-error intentional wrong type
    expect(logShowsStartup(undefined)).toBe(false);
    // @ts-expect-error intentional wrong type
    expect(logShowsStartup(null)).toBe(false);
  });
});

describe('logShowsRendererFailure', () => {
  it.each([
    '[main] Renderer process gone: crashed 1',
    '[main] Failed to load: -6 ERR_FILE_NOT_FOUND file:///app/index.html',
    '[main] Failed to load renderer: boom',
    '[main] child-process-gone: GPU killed exit=15',
  ])('detects %s', (message) => {
    const line = `2026-01-01T00:00:00.000Z [error] [main] ${message}`;
    expect(logShowsRendererFailure(line)).toBe(true);
  });

  it('ignores a healthy renderer-loaded log', () => {
    expect(logShowsRendererFailure(RENDERER_URL_LINE)).toBe(false);
    expect(logShowsRendererFailure(RENDERER_SOURCE_LINE)).toBe(false);
    expect(logShowsRendererFailure('')).toBe(false);
  });

  it('still flags a failure that shares the file with the startup line', () => {
    const text = `${RENDERER_URL_LINE}\n2026-01-01T00:00:00.100Z [error] [main] [main] Renderer process gone: crashed 1\n`;
    expect(logShowsStartup(text)).toBe(true);
    expect(logShowsRendererFailure(text)).toBe(true);
  });
});

describe('shouldLaunchOnHost', () => {
  it('launches a native-arch AppImage', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'launch-arch-'));
    try {
      const x64 = writeElfAppImage(dir, 'app-x64.AppImage', EM_X86_64);
      const arm64 = writeElfAppImage(dir, 'app-arm64.AppImage', EM_AARCH64);
      expect(shouldLaunchOnHost(x64, 'x64')).toBe(true);
      expect(shouldLaunchOnHost(arm64, 'arm64')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips a cross-arch AppImage that cannot execute on the host', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'launch-arch-'));
    try {
      const arm64 = writeElfAppImage(dir, 'app-arm64.AppImage', EM_AARCH64);
      expect(shouldLaunchOnHost(arm64, 'x64')).toBe(false);
      const x64 = writeElfAppImage(dir, 'app-x64.AppImage', EM_X86_64);
      expect(shouldLaunchOnHost(x64, 'arm64')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildLaunchArgs', () => {
  it('redirects user data and disables the sandbox for headless CI', () => {
    const args = buildLaunchArgs('/tmp/ud');
    expect(args).toContain('--user-data-dir=/tmp/ud');
    expect(args).toContain('--no-sandbox');
    expect(args).toContain('--disable-setuid-sandbox');
  });
});

describe('buildLaunchEnv', () => {
  it('disables GPU/HW acceleration and preserves the base env', () => {
    const env = buildLaunchEnv({ EXISTING: '1' });
    expect(env.MESH_CLIENT_DISABLE_GPU).toBe('1');
    expect(env.EXISTING).toBe('1');
  });
});

/**
 * Tiny stand-in for AppRun. Writes mesh-client.log, optionally stderr, then
 * either exits or stays alive.
 * @param {{ logLine: string, stderrLine?: string, exitAfterMs?: number }} spec
 */
function fakeAppSource(spec) {
  const stderr = spec.stderrLine
    ? `process.stderr.write(${JSON.stringify(`${spec.stderrLine}\n`)});`
    : '';
  const hold =
    spec.exitAfterMs == null
      ? 'setInterval(() => {}, 1000);'
      : `setTimeout(() => process.exit(0), ${spec.exitAfterMs});`;
  return `
    const fs = require('fs');
    const path = require('path');
    const logPath = path.join(process.env.SMOKE_USER_DATA, ${JSON.stringify(LOG_FILENAME)});
    fs.writeFileSync(logPath, ${JSON.stringify(`${spec.logLine}\n`)});
    ${stderr}
    ${hold}
  `;
}

/**
 * @param {string} source
 * @param {{ startupAliveMs: number, logWaitMs: number }} timings
 */
async function runFake(source, timings) {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'mesh-launch-smoke-'));
  try {
    await launchAndAssert({
      command: process.execPath,
      args: ['-e', source],
      userDataDir,
      env: { ...process.env, SMOKE_USER_DATA: userDataDir },
      pollMs: 50,
      ...timings,
    });
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

describe('launchAndAssert', () => {
  it('passes when the process stays alive and logs a renderer-loaded line', async () => {
    await runFake(fakeAppSource({ logLine: RENDERER_URL_LINE }), {
      startupAliveMs: 400,
      logWaitMs: 2000,
    });
  }, 15_000);

  it('fails when the process logs startup then exits before the alive threshold', async () => {
    const err = await runFake(
      fakeAppSource({
        logLine: RENDERER_URL_LINE,
        exitAfterMs: 1000,
      }),
      { startupAliveMs: 2500, logWaitMs: 4000 },
    ).then(
      () => null,
      (caught) => caught,
    );
    expect(err).toBeInstanceOf(LaunchSmokeError);
    expect(err instanceof LaunchSmokeError ? err.message : '').toMatch(
      /exited shortly after startup/,
    );
  }, 15_000);

  it('fails when a renderer-gone line is on stderr and the process stays alive', async () => {
    await expect(
      runFake(
        fakeAppSource({
          logLine: RENDERER_URL_LINE,
          stderrLine: '[main] Renderer process gone: crashed 1',
        }),
        { startupAliveMs: 2000, logWaitMs: 3000 },
      ),
    ).rejects.toThrow(/renderer-gone, failed-load, or child-process-gone/);
  }, 15_000);

  it('fails when the log only has main-process lines', async () => {
    await expect(
      runFake(fakeAppSource({ logLine: MAIN_ONLY_LINE }), {
        startupAliveMs: 500,
        logWaitMs: 700,
      }),
    ).rejects.toThrow(/No renderer-loaded signal/);
  }, 15_000);
});
