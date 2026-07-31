// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rmSyncMock = vi.hoisted(() => vi.fn());
const existsSyncMock = vi.hoisted(() => vi.fn());
const mkdtempSyncMock = vi.hoisted(() => vi.fn());
const electronLaunchMock = vi.hoisted(() => vi.fn());

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    rmSync: (...args: unknown[]) => rmSyncMock(...args) as undefined,
    existsSync: (...args: unknown[]) => existsSyncMock(...args) as boolean,
    mkdtempSync: (...args: unknown[]) => mkdtempSyncMock(...args) as string,
  };
});

vi.mock('@playwright/test', () => ({
  _electron: {
    launch: (...args: unknown[]) => electronLaunchMock(...args) as unknown,
  },
  expect: vi.fn(),
}));

import { disposeUserData, launchApp } from '../../e2e/electronApp';

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
  beforeEach(() => {
    vi.useRealTimers();
    rmSyncMock.mockReset();
    existsSyncMock.mockReset();
    mkdtempSyncMock.mockReset();
    electronLaunchMock.mockReset();
    existsSyncMock.mockReturnValue(true);
    mkdtempSyncMock.mockReturnValue('/tmp/mesh-e2e-owned');
    rmSyncMock.mockImplementation(() => undefined);
  });

  it('closes Electron and disposes owned userData when firstWindow fails', async () => {
    const close = vi.fn(() => Promise.resolve());
    electronLaunchMock.mockResolvedValue({
      firstWindow: () => Promise.reject(new Error('no window')),
      close,
    });

    await expect(launchApp()).rejects.toThrow('no window');
    expect(close).toHaveBeenCalledTimes(1);
    expect(rmSyncMock).toHaveBeenCalledWith('/tmp/mesh-e2e-owned', {
      recursive: true,
      force: true,
    });
  });

  it('closes Electron but does not dispose caller-owned userData on failure', async () => {
    const close = vi.fn(() => Promise.resolve());
    electronLaunchMock.mockResolvedValue({
      firstWindow: () => Promise.reject(new Error('no window')),
      close,
    });

    await expect(launchApp({ userDataDir: '/tmp/mesh-e2e-retained' })).rejects.toThrow('no window');
    expect(close).toHaveBeenCalledTimes(1);
    expect(rmSyncMock).not.toHaveBeenCalled();
  });
});
