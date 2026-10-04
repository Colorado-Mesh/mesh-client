import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SERVICE_ANNOUNCEMENT_DISMISS_STORAGE_KEY } from '@/renderer/lib/serviceAnnouncementDismiss';
import type {
  ServiceAnnouncement,
  ServiceAnnouncementFetchResult,
} from '@/shared/serviceAnnouncementFeed';
import {
  MS_PER_MINUTE,
  SERVICE_ANNOUNCEMENT_CHECK_INTERVAL_MS,
  SERVICE_ANNOUNCEMENT_STARTUP_DELAY_MS,
} from '@/shared/timeConstants';

import { useServiceAnnouncements } from './useServiceAnnouncements';

const a: ServiceAnnouncement = { id: 'a', severity: 'info', title: 'A', body: 'Body A' };
const b: ServiceAnnouncement = {
  id: 'b',
  severity: 'warning',
  title: 'B',
  body: 'Body B',
  url: 'https://example.com/b',
};

const fetchMock = () => vi.mocked(window.electronAPI.serviceAnnouncements.fetch);

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useServiceAnnouncements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    fetchMock().mockReset();
    vi.mocked(window.electronAPI.serviceAnnouncements.openUrl).mockReset();
    vi.mocked(window.electronAPI.serviceAnnouncements.openUrl).mockResolvedValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks after the startup delay and on the interval', async () => {
    fetchMock().mockResolvedValue({ status: 'ok', announcements: [a] });
    const { result } = renderHook(() => useServiceAnnouncements());
    expect(fetchMock()).not.toHaveBeenCalled();
    await advance(SERVICE_ANNOUNCEMENT_STARTUP_DELAY_MS);
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expect(result.current.visible.map((x) => x.id)).toEqual(['a']);
    await advance(SERVICE_ANNOUNCEMENT_CHECK_INTERVAL_MS);
    expect(fetchMock()).toHaveBeenCalledTimes(2);
  });

  it.each<ServiceAnnouncementFetchResult>([{ status: 'offline' }, { status: 'error' }])(
    'keeps the current list on %o',
    async (failure) => {
      fetchMock()
        .mockResolvedValueOnce({ status: 'ok', announcements: [a] })
        .mockResolvedValueOnce(failure);
      const { result } = renderHook(() => useServiceAnnouncements());
      await advance(SERVICE_ANNOUNCEMENT_STARTUP_DELAY_MS);
      await advance(SERVICE_ANNOUNCEMENT_CHECK_INTERVAL_MS);
      expect(fetchMock()).toHaveBeenCalledTimes(2);
      expect(result.current.visible.map((x) => x.id)).toEqual(['a']);
    },
  );

  it('swallows an IPC rejection and keeps the current list', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    fetchMock()
      .mockResolvedValueOnce({ status: 'ok', announcements: [a] })
      .mockRejectedValueOnce(new Error('ipc gone'));
    const { result } = renderHook(() => useServiceAnnouncements());
    await advance(SERVICE_ANNOUNCEMENT_STARTUP_DELAY_MS);
    await advance(SERVICE_ANNOUNCEMENT_CHECK_INTERVAL_MS);
    expect(result.current.visible.map((x) => x.id)).toEqual(['a']);
    expect(debug).toHaveBeenCalled();
    debug.mockRestore();
  });

  it('a successful empty feed clears the list (announcement retracted)', async () => {
    fetchMock()
      .mockResolvedValueOnce({ status: 'ok', announcements: [a] })
      .mockResolvedValueOnce({ status: 'ok', announcements: [] });
    const { result } = renderHook(() => useServiceAnnouncements());
    await advance(SERVICE_ANNOUNCEMENT_STARTUP_DELAY_MS);
    await advance(SERVICE_ANNOUNCEMENT_CHECK_INTERVAL_MS);
    expect(result.current.visible).toEqual([]);
  });

  it('skips the check while the browser reports offline', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderHook(() => useServiceAnnouncements());
    await advance(SERVICE_ANNOUNCEMENT_STARTUP_DELAY_MS);
    expect(fetchMock()).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('dismissal persists and filters', async () => {
    localStorage.setItem(SERVICE_ANNOUNCEMENT_DISMISS_STORAGE_KEY, JSON.stringify(['a']));
    fetchMock().mockResolvedValue({ status: 'ok', announcements: [a, b] });
    const { result } = renderHook(() => useServiceAnnouncements());
    await advance(SERVICE_ANNOUNCEMENT_STARTUP_DELAY_MS);
    expect(result.current.visible.map((x) => x.id)).toEqual(['b']);
    act(() => {
      result.current.dismiss('b');
    });
    expect(result.current.visible).toEqual([]);
    expect(
      JSON.parse(localStorage.getItem(SERVICE_ANNOUNCEMENT_DISMISS_STORAGE_KEY) ?? '[]'),
    ).toEqual(['a', 'b']);
  });

  it('hides an announcement once it expires between fetches', async () => {
    vi.setSystemTime(Date.parse('2026-06-01T00:00:00Z'));
    fetchMock().mockResolvedValue({
      status: 'ok',
      announcements: [{ ...a, expiresAt: '2026-06-01T00:05:00Z' }],
    });
    const { result } = renderHook(() => useServiceAnnouncements());
    await advance(SERVICE_ANNOUNCEMENT_STARTUP_DELAY_MS);
    expect(result.current.visible).toHaveLength(1);
    await advance(5 * MS_PER_MINUTE);
    expect(result.current.visible).toEqual([]);
  });

  it('forwards link opens to main', async () => {
    const { result } = renderHook(() => useServiceAnnouncements());
    result.current.openUrl('https://example.com/b');
    await flush();
    expect(window.electronAPI.serviceAnnouncements.openUrl).toHaveBeenCalledWith(
      'https://example.com/b',
    );
  });
});
