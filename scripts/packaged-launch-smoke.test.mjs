import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LOG_FILENAME,
  LaunchSmokeError,
  baseLaunchArgs,
  launchAndAssert,
} from './packaged-launch-smoke.mjs';

const RENDERER_LOADED_LINE =
  '2026-01-01T00:00:00.000Z [debug] [main] [Startup] renderer loaded: file:///app/index.html';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('baseLaunchArgs', () => {
  it('returns exactly one --user-data-dir argument', () => {
    expect(baseLaunchArgs('/tmp/ud')).toEqual(['--user-data-dir=/tmp/ud']);
  });
});

describe('launchAndAssert shared surface', () => {
  it('includes a userDataDir listing when no log appears', async () => {
    const userDataDir = mkdtempSync(path.join(tmpdir(), 'mesh-launch-listing-'));
    writeFileSync(path.join(userDataDir, 'marker.txt'), 'hi');
    // Stay alive with no mesh-client.log so the log-wait deadline fires (not a crash exit).
    const source = 'setInterval(() => {}, 1000);';
    try {
      const err = await launchAndAssert({
        command: process.execPath,
        args: ['-e', source],
        userDataDir,
        env: { ...process.env },
        startupAliveMs: 2000,
        logWaitMs: 400,
        pollMs: 50,
      }).then(
        () => null,
        (caught) => caught,
      );
      expect(err).toBeInstanceOf(LaunchSmokeError);
      const message = err instanceof LaunchSmokeError ? err.message : '';
      expect(message).toMatch(/No renderer-loaded signal/);
      expect(message).toMatch(/userDataDir listing/);
      expect(message).toMatch(/marker\.txt/);
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('prints the label in the success line', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const userDataDir = mkdtempSync(path.join(tmpdir(), 'mesh-launch-label-'));
    const source = `
      const fs = require('fs');
      const path = require('path');
      fs.writeFileSync(path.join(process.env.SMOKE_USER_DATA, ${JSON.stringify(LOG_FILENAME)}), ${JSON.stringify(`${RENDERER_LOADED_LINE}\n`)});
      setInterval(() => {}, 1000);
    `;
    try {
      await launchAndAssert({
        label: 'test-label-smoke',
        command: process.execPath,
        args: ['-e', source],
        userDataDir,
        env: { ...process.env, SMOKE_USER_DATA: userDataDir },
        startupAliveMs: 300,
        logWaitMs: 2000,
        pollMs: 50,
      });
      expect(debug).toHaveBeenCalledWith(
        '[test-label-smoke] OK — app booted and the renderer loaded',
      );
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('teardown resolves when the child ignores SIGTERM', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const userDataDir = mkdtempSync(path.join(tmpdir(), 'mesh-launch-term-'));
    const source = `
      const fs = require('fs');
      const path = require('path');
      fs.writeFileSync(path.join(process.env.SMOKE_USER_DATA, ${JSON.stringify(LOG_FILENAME)}), ${JSON.stringify(`${RENDERER_LOADED_LINE}\n`)});
      process.on('SIGTERM', () => {
        setTimeout(() => process.exit(0), 300);
      });
      setInterval(() => {}, 1000);
    `;
    try {
      await launchAndAssert({
        command: process.execPath,
        args: ['-e', source],
        userDataDir,
        env: { ...process.env, SMOKE_USER_DATA: userDataDir },
        startupAliveMs: 300,
        logWaitMs: 2000,
        pollMs: 50,
        killGraceMs: 150,
      });
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  }, 15_000);
});
