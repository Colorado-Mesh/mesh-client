// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GattBleSessionId } from '@/shared/electron-api.types';

import { TransportSidecarGatt } from './transportSidecarGatt';

describe('TransportSidecarGatt', () => {
  const fromRadioCbs = new Set<
    (payload: { sessionId: GattBleSessionId; bytes: Uint8Array }) => void
  >();

  function emitFromRadio(payload: { sessionId: GattBleSessionId; bytes: Uint8Array }): void {
    for (const cb of fromRadioCbs) cb(payload);
  }

  beforeEach(() => {
    fromRadioCbs.clear();
    window.electronAPI = {
      ...window.electronAPI,
      onGattFromRadio: (cb) => {
        fromRadioCbs.add(cb);
        return () => {
          fromRadioCbs.delete(cb);
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

    emitFromRadio({ sessionId: 'meshtastic', bytes: new Uint8Array([1, 2, 3]) });

    const { value, done } = await readPromise;
    expect(done).toBe(false);
    expect(value).toEqual({ type: 'packet', data: new Uint8Array([1, 2, 3]) });
    reader.releaseLock();
    await transport.disconnect();
  });

  it('ignores fromRadio for other sessions', async () => {
    const transport = new TransportSidecarGatt('meshtastic');
    const reader = transport.fromDevice.getReader();
    emitFromRadio({ sessionId: 'meshcore', bytes: new Uint8Array([9]) });
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

  it('retireInbound stops the stale listener without disconnectGatt while live transport still receives', async () => {
    const stale = new TransportSidecarGatt('meshtastic');
    const live = new TransportSidecarGatt('meshtastic');
    const staleReader = stale.fromDevice.getReader();
    const liveReader = live.fromDevice.getReader();

    // Pending write on stale toDevice (writable locked) must not block inbound retire.
    const staleWriter = stale.toDevice.getWriter();
    let releaseWrite: () => void = () => {};
    const pendingWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    vi.mocked(window.electronAPI.gattToRadio).mockImplementationOnce(() => pendingWrite);

    const writePromise = staleWriter.write(new Uint8Array([7]));
    stale.retireInbound();

    expect(window.electronAPI.disconnectGatt).not.toHaveBeenCalled();

    emitFromRadio({ sessionId: 'meshtastic', bytes: new Uint8Array([1]) });
    const liveRead = await liveReader.read();
    expect(liveRead.value).toEqual({ type: 'packet', data: new Uint8Array([1]) });

    // fromDevice controller was closed — stale decoder is retired.
    const staleResult = await staleReader.read();
    expect(staleResult.done).toBe(true);

    releaseWrite();
    await expect(writePromise).resolves.toBeUndefined();
    staleWriter.releaseLock();
    staleReader.releaseLock();
    liveReader.releaseLock();
    await live.disconnect();
  });

  it('retireInbound still works after a rejected toDevice write', async () => {
    const stale = new TransportSidecarGatt('meshtastic');
    const live = new TransportSidecarGatt('meshtastic');
    vi.mocked(window.electronAPI.gattToRadio).mockRejectedValueOnce(new Error('write failed'));
    const writer = stale.toDevice.getWriter();
    await expect(writer.write(new Uint8Array([1]))).rejects.toThrow('write failed');
    writer.releaseLock();

    stale.retireInbound();
    expect(window.electronAPI.disconnectGatt).not.toHaveBeenCalled();

    const liveReader = live.fromDevice.getReader();
    emitFromRadio({ sessionId: 'meshtastic', bytes: new Uint8Array([9]) });
    const { value } = await liveReader.read();
    expect(value).toEqual({ type: 'packet', data: new Uint8Array([9]) });
    liveReader.releaseLock();
    await live.disconnect();
  });
});
