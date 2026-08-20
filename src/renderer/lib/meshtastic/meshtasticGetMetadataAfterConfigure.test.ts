import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_DEFER_MS,
  MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS,
} from '@/renderer/lib/timeConstants';
import { MS_PER_SECOND } from '@/shared/timeConstants';

import {
  cancelMeshtasticGetMetadataAfterConfigure,
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
});
