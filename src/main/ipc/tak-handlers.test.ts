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

describe('tak:pushNodeUpdates', () => {
  type BatchHandler = (event: unknown, nodes: unknown) => void;

  async function registerWith(manager: unknown): Promise<BatchHandler> {
    const { ipcMain } = await import('electron');
    const handle = vi.mocked(ipcMain.handle);
    handle.mockClear();
    registerTakIpcHandlers({
      idleTakStatus: { running: false, port: 8089, clientCount: 0 },
      ensureTakServerManager: vi.fn(),
      getTakServerManager: () => manager as never,
      validateTakSettings: vi.fn(),
    });
    return handle.mock.calls.find((c) => c[0] === 'tak:pushNodeUpdates')?.[1] as BatchHandler;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards valid updates and drops invalid ones', async () => {
    const onNodeUpdate = vi.fn();
    const handler = await registerWith({ hasActiveSink: () => true, onNodeUpdate });
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    handler({}, [
      { node_id: 1, protocol: 'meshcore', latitude: 40, longitude: -105 },
      { node_id: -1 },
      { node_id: 2, protocol: 'reticulum', latitude: 41, longitude: -104 },
    ]);

    expect(assertIpcSender).toHaveBeenCalledWith({}, 'tak:pushNodeUpdates');
    expect(onNodeUpdate.mock.calls.map((c) => (c[0] as { node_id: number }).node_id)).toEqual([
      1, 2,
    ]);
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('dropped 1 invalid'));
    debugSpy.mockRestore();
  });

  it('skips the batch when no sink is active', async () => {
    const onNodeUpdate = vi.fn();
    const handler = await registerWith({ hasActiveSink: () => false, onNodeUpdate });
    handler({}, [{ node_id: 1, latitude: 40, longitude: -105 }]);
    expect(onNodeUpdate).not.toHaveBeenCalled();
  });

  it('skips the batch when the TAK module has not been loaded', async () => {
    const handler = await registerWith(null);
    expect(() => {
      handler({}, [{ node_id: 1 }]);
    }).not.toThrow();
  });

  it.each([
    ['a non-array', { node_id: 1 }],
    ['an oversized batch', Array.from({ length: 501 }, (_, i) => ({ node_id: i + 1 }))],
  ])('rejects %s', async (_label, nodes) => {
    const handler = await registerWith({ hasActiveSink: () => true, onNodeUpdate: vi.fn() });
    expect(() => {
      handler({}, nodes);
    }).toThrow(/at most 500/);
  });
});
