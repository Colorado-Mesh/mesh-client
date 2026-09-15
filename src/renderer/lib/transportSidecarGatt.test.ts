// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GattBleSessionId } from '@/shared/electron-api.types';

import { TransportSidecarGatt } from './transportSidecarGatt';

describe('TransportSidecarGatt', () => {
  let fromRadioCb: ((payload: { sessionId: GattBleSessionId; bytes: Uint8Array }) => void) | null =
    null;

  beforeEach(() => {
    fromRadioCb = null;
    window.electronAPI = {
      ...window.electronAPI,
      onGattFromRadio: (cb) => {
        fromRadioCb = cb;
        return () => {
          fromRadioCb = null;
        };
      },
      gattToRadio: vi.fn().mockResolvedValue(undefined),
      disconnectGatt: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards matching onGattFromRadio bytes as packet DeviceOutput', async () => {
    const transport = new TransportSidecarGatt('meshtastic');
    const reader = transport.fromDevice.getReader();
    const readPromise = reader.read();

    fromRadioCb?.({ sessionId: 'meshtastic', bytes: new Uint8Array([1, 2, 3]) });

    const { value, done } = await readPromise;
    expect(done).toBe(false);
    expect(value).toEqual({ type: 'packet', data: new Uint8Array([1, 2, 3]) });
    reader.releaseLock();
    await transport.disconnect();
  });

  it('ignores fromRadio for other sessions', async () => {
    const transport = new TransportSidecarGatt('meshtastic');
    const reader = transport.fromDevice.getReader();
    fromRadioCb?.({ sessionId: 'meshcore', bytes: new Uint8Array([9]) });
    const raced = await Promise.race([
      reader.read().then(() => 'got'),
      new Promise<'timeout'>((r) => {
        setTimeout(() => {
          r('timeout');
        }, 30);
      }),
    ]);
    expect(raced).toBe('timeout');
    reader.releaseLock();
    await transport.disconnect();
  });

  it('gattToRadio forwards toDevice writes', async () => {
    const transport = new TransportSidecarGatt('meshcore');
    const writer = transport.toDevice.getWriter();
    await writer.write(new Uint8Array([4, 5]));
    writer.releaseLock();
    expect(window.electronAPI.gattToRadio).toHaveBeenCalledWith('meshcore', new Uint8Array([4, 5]));
    await transport.disconnect();
  });

  it('disconnect calls disconnectGatt', async () => {
    const transport = new TransportSidecarGatt('meshtastic');
    await transport.disconnect();
    expect(window.electronAPI.disconnectGatt).toHaveBeenCalledWith('meshtastic');
  });
});
