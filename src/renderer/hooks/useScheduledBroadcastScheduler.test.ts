// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearScheduledBroadcastDeliveryAdapters,
  getScheduledBroadcastDeliveryAdapters,
} from '../lib/scheduledBroadcasts/deliveryAdapters';
import { useScheduledBroadcastScheduler } from './useScheduledBroadcastScheduler';

describe('useScheduledBroadcastScheduler', () => {
  beforeEach(() => {
    clearScheduledBroadcastDeliveryAdapters();
  });
  afterEach(() => {
    clearScheduledBroadcastDeliveryAdapters();
  });

  it('registers a room-post adapter that always calls the latest callback', async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    const { rerender, unmount } = renderHook(
      ({ cb }) => {
        useScheduledBroadcastScheduler({ sendRoomPost: cb });
      },
      { initialProps: { cb: first } },
    );
    await waitFor(() => {
      expect(getScheduledBroadcastDeliveryAdapters().sendRoomPost).toBeTypeOf('function');
    });
    rerender({ cb: second });
    await getScheduledBroadcastDeliveryAdapters().sendRoomPost?.(7, 'hi');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(7, 'hi');
    unmount();
    await waitFor(() => {
      expect(getScheduledBroadcastDeliveryAdapters().sendRoomPost).toBeUndefined();
    });
  });

  it('rejects room posts when no callback is provided', async () => {
    renderHook(() => {
      useScheduledBroadcastScheduler();
    });
    await waitFor(() => {
      expect(getScheduledBroadcastDeliveryAdapters().sendRoomPost).toBeTypeOf('function');
    });
    await expect(getScheduledBroadcastDeliveryAdapters().sendRoomPost?.(7, 'hi')).rejects.toThrow(
      'MeshCore room post unavailable',
    );
  });
});
