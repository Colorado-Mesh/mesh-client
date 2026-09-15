import { describe, expect, it, vi } from 'vitest';

import { writeGattToRadio } from './gattIpcWrite';

describe('GATT IPC writes', () => {
  it.each(['fetch failed', 'write timeout', 'request aborted', 'write_failed'])(
    'reports %s to the transport instead of acknowledging an unconfirmed write',
    async (message) => {
      const error = new Error(message);
      const proxy = {
        isConnected: vi.fn().mockResolvedValue(true),
        toRadio: vi.fn().mockRejectedValue(error),
      };
      await expect(writeGattToRadio(proxy, 'meshtastic', new Uint8Array([1]))).rejects.toBe(error);
    },
  );

  it.each(['meshtastic', 'meshcore'] as const)('delivers %s bytes unchanged', async (sessionId) => {
    const proxy = {
      isConnected: vi.fn().mockResolvedValue(true),
      toRadio: vi.fn().mockResolvedValue(undefined),
    };
    const bytes = new Uint8Array([1, 2, 3]);
    await writeGattToRadio(proxy, sessionId, bytes);
    expect(proxy.toRadio).toHaveBeenCalledWith(sessionId, bytes);
  });

  it('ignores a device disconnect between the liveness probe and write', async () => {
    const proxy = {
      isConnected: vi.fn().mockResolvedValue(true),
      toRadio: vi.fn().mockRejectedValue(new Error('device disconnected')),
    };
    await expect(writeGattToRadio(proxy, 'meshcore', new Uint8Array([1]))).resolves.toBeUndefined();
  });

  it('does not send after the session is disconnected', async () => {
    const proxy = {
      isConnected: vi.fn().mockResolvedValue(false),
      toRadio: vi.fn(),
    };
    await writeGattToRadio(proxy, 'meshtastic', new Uint8Array([1]));
    expect(proxy.toRadio).not.toHaveBeenCalled();
  });
});
