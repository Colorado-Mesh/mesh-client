import { MeshDevice, type Types } from '@meshtastic/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_DEFER_MS,
  MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS,
} from '@/renderer/lib/timeConstants';
import { MS_PER_SECOND } from '@/shared/timeConstants';

import {
  cancelMeshtasticGetMetadataAfterConfigure,
  type GetMetadataAfterConfigureTimerRef,
  scheduleMeshtasticGetMetadataAfterConfigure,
} from './meshtasticGetMetadataAfterConfigure';

describe('meshtasticGetMetadataAfterConfigure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives defer/retry delays from MS_PER_SECOND', () => {
    expect(MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_DEFER_MS).toBe(12 * MS_PER_SECOND);
    expect(MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS).toBe(30 * MS_PER_SECOND);
  });

  it('does not call getMetadata immediately; fires after defer', async () => {
    const getMetadata = vi.fn().mockResolvedValue(undefined);
    const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    scheduleMeshtasticGetMetadataAfterConfigure({ getMetadata }, 0x1234, timerRef);
    expect(getMetadata).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_DEFER_MS - 1);
    expect(getMetadata).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(getMetadata).toHaveBeenCalledTimes(1);
    expect(getMetadata).toHaveBeenCalledWith(0x1234);
  });

  it('retries once after failure with longer gap', async () => {
    const getMetadata = vi
      .fn()
      .mockRejectedValueOnce(new Error('Packet 1 of type packet timed out'))
      .mockResolvedValueOnce(undefined);
    const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    scheduleMeshtasticGetMetadataAfterConfigure({ getMetadata }, 7, timerRef);
    await vi.advanceTimersByTimeAsync(MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_DEFER_MS);
    expect(getMetadata).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS - 1);
    expect(getMetadata).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(getMetadata).toHaveBeenCalledTimes(2);
  });

  it('does not schedule further attempts after success', async () => {
    const getMetadata = vi.fn().mockResolvedValue(undefined);
    const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    scheduleMeshtasticGetMetadataAfterConfigure({ getMetadata }, 1, timerRef);
    await vi.advanceTimersByTimeAsync(MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_DEFER_MS);
    expect(getMetadata).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS * 2);
    expect(getMetadata).toHaveBeenCalledTimes(1);
  });

  it('cancel before defer prevents getMetadata', async () => {
    const getMetadata = vi.fn().mockResolvedValue(undefined);
    const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    scheduleMeshtasticGetMetadataAfterConfigure({ getMetadata }, 1, timerRef);
    cancelMeshtasticGetMetadataAfterConfigure(timerRef);
    await vi.advanceTimersByTimeAsync(MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_DEFER_MS * 2);
    expect(getMetadata).not.toHaveBeenCalled();
  });

  it('cancel after getMetadata started prevents retry on reject', async () => {
    let rejectFirst!: (e: Error) => void;
    const first = new Promise<unknown>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const getMetadata = vi.fn().mockReturnValueOnce(first);
    const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    scheduleMeshtasticGetMetadataAfterConfigure({ getMetadata }, 1, timerRef);
    await vi.advanceTimersByTimeAsync(MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_DEFER_MS);
    expect(getMetadata).toHaveBeenCalledTimes(1);
    cancelMeshtasticGetMetadataAfterConfigure(timerRef);
    rejectFirst(new Error('Packet timed out'));
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS * 2);
    expect(getMetadata).toHaveBeenCalledTimes(1);
  });

  it('replacement schedule ignores stale reject from the prior getMetadata', async () => {
    let rejectFirst!: (e: Error) => void;
    const first = new Promise<unknown>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const getMetadata = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(undefined);
    const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    scheduleMeshtasticGetMetadataAfterConfigure({ getMetadata }, 1, timerRef);
    await vi.advanceTimersByTimeAsync(MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_DEFER_MS);
    expect(getMetadata).toHaveBeenCalledTimes(1);

    scheduleMeshtasticGetMetadataAfterConfigure({ getMetadata }, 1, timerRef);
    rejectFirst(new Error('stale Packet timed out'));
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_DEFER_MS);
    expect(getMetadata).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS * 2);
    expect(getMetadata).toHaveBeenCalledTimes(2);
  });

  it('subscribes on a real @meshtastic/core dispatcher without losing `this` (#1142)', async () => {
    const transport = {
      fromDevice: new ReadableStream(),
      toDevice: new WritableStream<Uint8Array>(),
    } as unknown as Types.Transport;
    const device = new MeshDevice(transport);
    const getMetadata = vi.fn().mockResolvedValue(undefined);
    const timerRef: GetMetadataAfterConfigureTimerRef = { current: null };

    expect(() => {
      scheduleMeshtasticGetMetadataAfterConfigure(
        { getMetadata, events: device.events },
        1,
        timerRef,
      );
    }).not.toThrow();
    expect(device.events.onDeviceMetadataPacket.count).toBe(1);

    device.events.onDeviceMetadataPacket.dispatch(
      {} as Parameters<typeof device.events.onDeviceMetadataPacket.dispatch>[0],
    );
    expect(device.events.onDeviceMetadataPacket.count).toBe(0);
    await vi.advanceTimersByTimeAsync(MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_DEFER_MS);
    expect(getMetadata).not.toHaveBeenCalled();
  });

  describe('DeviceMetadata packet counts as success', () => {
    function makeEvents() {
      const handlers = new Set<(packet: unknown) => void>();
      const unsubscribe = vi.fn();
      const events = {
        onDeviceMetadataPacket: {
          subscribe: vi.fn((cb: (packet: unknown) => void) => {
            handlers.add(cb);
            return () => {
              unsubscribe();
              handlers.delete(cb);
            };
          }),
        },
      };
      const dispatch = () => {
        for (const cb of [...handlers]) cb({ data: {} });
      };
      return { events, dispatch, unsubscribe, handlerCount: () => handlers.size };
    }

    it('skips retry and failure log when metadata arrives before the ACK timeout', async () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      let rejectFirst!: (e: Error) => void;
      const getMetadata = vi.fn().mockReturnValueOnce(
        new Promise<unknown>((_resolve, reject) => {
          rejectFirst = reject;
        }),
      );
      const { events, dispatch, handlerCount } = makeEvents();
      const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
      scheduleMeshtasticGetMetadataAfterConfigure({ getMetadata, events }, 1, timerRef);
      await vi.advanceTimersByTimeAsync(MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_DEFER_MS);
      expect(getMetadata).toHaveBeenCalledTimes(1);

      dispatch();
      expect(handlerCount()).toBe(0);
      rejectFirst(new Error('Packet 1 of type packet timed out'));
      await vi.advanceTimersByTimeAsync(MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS * 2);

      expect(getMetadata).toHaveBeenCalledTimes(1);
      expect(debugSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('getMetadata after configure failed'),
      );
      debugSpy.mockRestore();
    });

    it('still retries when no metadata packet arrives', async () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const getMetadata = vi
        .fn()
        .mockRejectedValueOnce(new Error('Packet 1 of type packet timed out'))
        .mockResolvedValueOnce(undefined);
      const { events } = makeEvents();
      const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
      scheduleMeshtasticGetMetadataAfterConfigure({ getMetadata, events }, 1, timerRef);
      await vi.advanceTimersByTimeAsync(
        MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_DEFER_MS +
          MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS,
      );
      expect(getMetadata).toHaveBeenCalledTimes(2);
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('getMetadata after configure failed'),
      );
      debugSpy.mockRestore();
    });

    it('cancel unsubscribes from metadata packets', () => {
      const getMetadata = vi.fn().mockResolvedValue(undefined);
      const { events, unsubscribe, handlerCount } = makeEvents();
      const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
      scheduleMeshtasticGetMetadataAfterConfigure({ getMetadata, events }, 1, timerRef);
      expect(handlerCount()).toBe(1);
      cancelMeshtasticGetMetadataAfterConfigure(timerRef);
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(handlerCount()).toBe(0);
    });
  });
});
