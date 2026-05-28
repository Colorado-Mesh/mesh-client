import type { MeshDevice } from '@meshtastic/core';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as connection from '../lib/connection';
import { useMeshtasticRuntime } from '../runtime/useMeshtasticRuntime';

vi.mock('../lib/connection', () => ({
  createBleConnection: vi.fn(),
  createConnection: vi.fn(),
  reconnectSerial: vi.fn(),
  safeDisconnect: vi.fn().mockResolvedValue(undefined),
}));

function createStubDevice(configure: MeshDevice['configure']): MeshDevice {
  const noopSub = { subscribe: () => () => {} };
  const events = new Proxy({} as MeshDevice['events'], {
    get: () => noopSub,
  });
  return { configure, events, transport: {} } as unknown as MeshDevice;
}

describe('useMeshtasticRuntime — configure() rejection', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('rejects connect() and resets state when configure fails (no unhandled rejection)', async () => {
    const err = new Error('Permission denied');
    const device = createStubDevice(vi.fn().mockRejectedValue(err));
    vi.mocked(connection.createConnection).mockResolvedValue(device);

    const { result } = renderHook(() => useMeshtasticRuntime());

    await expect(result.current.connect('http', 'http://127.0.0.1')).rejects.toThrow(
      'Permission denied',
    );

    await waitFor(() => {
      expect(result.current.state.status).toBe('disconnected');
    });
  });
});
