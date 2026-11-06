// @vitest-environment node
import type { ChildProcess } from 'node:child_process';
import type * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rmSyncMock = vi.hoisted(() => vi.fn());
const existsSyncMock = vi.hoisted(() => vi.fn());
const mkdtempSyncMock = vi.hoisted(() => vi.fn());
const electronLaunchMock = vi.hoisted(() => vi.fn());
const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    rmSync: (...args: unknown[]) => rmSyncMock(...args) as undefined,
    existsSync: (...args: unknown[]) => existsSyncMock(...args) as boolean,
    mkdtempSync: (...args: unknown[]) => mkdtempSyncMock(...args) as string,
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    execFileSync: (...args: unknown[]) => execFileSyncMock(...args) as undefined,
  };
});

vi.mock('@playwright/test', () => ({
  _electron: {
    launch: (...args: unknown[]) => electronLaunchMock(...args) as unknown,
  },
  expect: vi.fn(),
}));

import {
  closeApp,
  closeElectronApplication,
  disposeUserData,
  forceKillElectronProcess,
  launchApp,
  type LaunchedApp,
  teardownApp,
} from '../../e2e/electronApp';

describe('disposeUserData', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rmSyncMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries rmSync failures then throws the last error', async () => {
    rmSyncMock.mockImplementation(() => {
      throw new Error('EBUSY');
    });

    const pending = disposeUserData('/tmp/mesh-e2e-locked');
    const assertion = expect(pending).rejects.toThrow('EBUSY');
    await vi.runAllTimersAsync();
    await assertion;
    expect(rmSyncMock).toHaveBeenCalledTimes(5);
  });

  it('succeeds when a later retry clears the directory', async () => {
    rmSyncMock
      .mockImplementationOnce(() => {
        throw new Error('EBUSY');
      })
      .mockImplementationOnce(() => undefined);

    const pending = disposeUserData('/tmp/mesh-e2e-retry');
    const done = pending.then(() => undefined);
    await vi.runAllTimersAsync();
    await done;
    expect(rmSyncMock).toHaveBeenCalledTimes(2);
  });
});

describe('launchApp failure cleanup', () => {
  let actualFs: typeof fs;
  let userDataDir: string;

  beforeEach(async () => {
    vi.useRealTimers();
    rmSyncMock.mockReset();
    existsSyncMock.mockReset();
    mkdtempSyncMock.mockReset();
    electronLaunchMock.mockReset();
    actualFs = await vi.importActual<typeof fs>('node:fs');
    userDataDir = actualFs.mkdtempSync(path.join(tmpdir(), 'mesh-e2e-'));
    existsSyncMock.mockReturnValue(true);
    mkdtempSyncMock.mockReturnValue(userDataDir);
    rmSyncMock.mockImplementation((...args: Parameters<typeof actualFs.rmSync>) => {
      actualFs.rmSync(...args);
    });
  });

  afterEach(() => {
    actualFs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('closes Electron and disposes owned userData when firstWindow fails', async () => {
    const close = vi.fn(() => Promise.resolve());
    electronLaunchMock.mockResolvedValue({
      firstWindow: () => Promise.reject(new Error('no window')),
      close,
      process: () => ({ pid: 1, exitCode: 0, signalCode: null }),
    });

    await expect(launchApp()).rejects.toThrow('no window');
    expect(close).toHaveBeenCalledTimes(1);
    expect(rmSyncMock).toHaveBeenCalledWith(userDataDir, {
      recursive: true,
      force: true,
    });
    expect(actualFs.existsSync(userDataDir)).toBe(false);
  });

  it('closes Electron but does not dispose caller-owned userData on failure', async () => {
    const close = vi.fn(() => Promise.resolve());
    electronLaunchMock.mockResolvedValue({
      firstWindow: () => Promise.reject(new Error('no window')),
      close,
      process: () => ({ pid: 1, exitCode: 0, signalCode: null }),
    });

    await expect(launchApp({ userDataDir })).rejects.toThrow('no window');
    expect(close).toHaveBeenCalledTimes(1);
    expect(rmSyncMock).not.toHaveBeenCalled();
    const launchOptions = electronLaunchMock.mock.calls[0]?.[0] as {
      env: { MESH_E2E_PROFILE_TOKEN: string };
    };
    expect(actualFs.readFileSync(path.join(userDataDir, '.mesh-e2e-profile'), 'utf8')).toBe(
      launchOptions.env.MESH_E2E_PROFILE_TOKEN,
    );
  });
});

describe('forceKillElectronProcess', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it('no-ops when the process has already exited', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    forceKillElectronProcess({
      pid: 99,
      exitCode: 0,
      signalCode: null,
    } as ChildProcess);
    expect(killSpy).not.toHaveBeenCalled();
    expect(execFileSyncMock).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it.each(['linux', 'darwin'] as const)('SIGKILLs the main pid on %s', (platform) => {
    const previous = process.platform;
    Object.defineProperty(process, 'platform', { value: platform });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    forceKillElectronProcess({
      pid: 55,
      exitCode: null,
      signalCode: null,
    } as ChildProcess);
    expect(killSpy).toHaveBeenCalledWith(55, 'SIGKILL');
    killSpy.mockRestore();
    Object.defineProperty(process, 'platform', { value: previous });
  });

  it('uses taskkill /T on win32', () => {
    const previous = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    forceKillElectronProcess({
      pid: 88,
      exitCode: null,
      signalCode: null,
    } as ChildProcess);
    expect(execFileSyncMock).toHaveBeenCalledWith('taskkill', ['/pid', '88', '/T', '/F'], {
      stdio: 'ignore',
    });
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
    Object.defineProperty(process, 'platform', { value: previous });
  });
});

describe('closeElectronApplication', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    execFileSyncMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when close finishes before the timeout', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const close = vi.fn(() => Promise.resolve());
    const app = {
      close,
      // Close completed and the process has already exited.
      process: () => ({ pid: 1, exitCode: 0, signalCode: null }),
    };

    const done = closeElectronApplication(app as never);
    await vi.runAllTimersAsync();
    await done;

    expect(close).toHaveBeenCalledTimes(1);
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it('force-kills when close hangs past CLOSE_APP_TIMEOUT_MS', async () => {
    const previous = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const proc = {
      pid: 1234,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
    };
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      proc.exitCode = 1;
      return true;
    });
    const close = vi.fn(() => new Promise<void>(() => undefined));
    const app = {
      close,
      process: () => proc,
    };

    const done = closeElectronApplication(app as never);
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await done;

    expect(killSpy).toHaveBeenCalledWith(1234, 'SIGKILL');
    killSpy.mockRestore();
    Object.defineProperty(process, 'platform', { value: previous });
  });

  it('force-kills when close rejects while the process is still live', async () => {
    const previous = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const proc = {
      pid: 5678,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
    };
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      proc.exitCode = 1;
      return true;
    });
    const close = vi.fn(() => Promise.reject(new Error('close failed')));
    const app = {
      close,
      process: () => proc,
    };

    const done = closeElectronApplication(app as never);
    await vi.runAllTimersAsync();
    await done;

    expect(killSpy).toHaveBeenCalledWith(5678, 'SIGKILL');
    killSpy.mockRestore();
    Object.defineProperty(process, 'platform', { value: previous });
  });

  it('throws when the process remains live after force-kill wait', async () => {
    const previous = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const close = vi.fn(() => Promise.reject(new Error('close failed')));
    const app = {
      close,
      process: () => ({ pid: 999, exitCode: null, signalCode: null }),
    };

    const done = closeElectronApplication(app as never);
    const assertion = expect(done).rejects.toThrow(
      /Electron process still running after close\/force-kill/,
    );
    await vi.runAllTimersAsync();
    await assertion;

    expect(killSpy).toHaveBeenCalledWith(999, 'SIGKILL');
    killSpy.mockRestore();
    Object.defineProperty(process, 'platform', { value: previous });
  });

  it('closeApp delegates to closeElectronApplication', async () => {
    const close = vi.fn(() => Promise.resolve());
    const launched = {
      app: {
        close,
        process: () => ({ pid: 1, exitCode: 0, signalCode: null }),
      },
    } as unknown as LaunchedApp;

    const done = closeApp(launched);
    await vi.runAllTimersAsync();
    await done;
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('teardownApp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rmSyncMock.mockReset();
    execFileSyncMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not dispose userData when Electron is still running after shutdown', async () => {
    const previous = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const launched = {
      retainUserData: false,
      userDataDir: '/tmp/mesh-e2e-still-live',
      app: {
        close: () => Promise.reject(new Error('close failed')),
        process: () => ({ pid: 42, exitCode: null, signalCode: null }),
      },
    } as unknown as LaunchedApp;

    const done = teardownApp(launched);
    const assertion = expect(done).rejects.toThrow(/still running/);
    await vi.runAllTimersAsync();
    await assertion;

    expect(rmSyncMock).not.toHaveBeenCalled();
    killSpy.mockRestore();
    Object.defineProperty(process, 'platform', { value: previous });
  });
});
