// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../validate-ipc-sender', () => ({
  assertIpcSender: vi.fn(),
}));

import { assertIpcSender } from '../validate-ipc-sender';
import { registerTakIpcHandlers } from './tak-handlers';

describe('tak-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers tak channels with assertIpcSender', async () => {
    const { ipcMain } = await import('electron');
    const handle = vi.mocked(ipcMain.handle);
    const stop = vi.fn();
    registerTakIpcHandlers({
      idleTakStatus: { status: 'disconnected' } as never,
      ensureTakServerManager: vi.fn(),
      getTakServerManager: () => ({ stop }) as never,
      validateTakSettings: vi.fn(),
    });

    const channels = handle.mock.calls.map((c) => c[0]);
    expect(channels).toEqual(
      expect.arrayContaining([
        'tak:start',
        'tak:stop',
        'tak:getStatus',
        'tak:getConnectedClients',
        'tak:generateDataPackage',
        'tak:regenerateCertificates',
        'tak:pushNodeUpdate',
      ]),
    );

    const stopHandler = handle.mock.calls.find((c) => c[0] === 'tak:stop')?.[1] as (
      event: unknown,
    ) => void;
    const event = {};
    stopHandler(event);
    expect(assertIpcSender).toHaveBeenCalledWith(event, 'tak:stop');
    expect(stop).toHaveBeenCalled();
  });
});
