import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  longSessionMaintenanceTestApi,
  useLongSessionMaintenance,
} from './useLongSessionMaintenance';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const FOUR_DAYS = longSessionMaintenanceTestApi.RESTART_NUDGE_UPTIME_SEC;
const TWELVE_H_MS = longSessionMaintenanceTestApi.RESTART_NUDGE_REPROMPT_MS;
/** Match hook hourly check interval. */
const MS_PER_HOUR_FAKE = 60 * 60 * 1000;

function mockApi(opts: {
  platform?: string;
  uptimeSec?: number;
  meshtasticBle?: boolean;
  meshcoreBle?: boolean;
  uptimeReject?: boolean;
  nobleReject?: boolean;
}): void {
  const getProcessUptimeSec = opts.uptimeReject
    ? vi.fn().mockRejectedValue(new Error('uptime failed'))
    : vi.fn().mockResolvedValue(opts.uptimeSec ?? 0);
  const isNobleBleConnected = opts.nobleReject
    ? vi.fn().mockRejectedValue(new Error('noble failed'))
    : vi.fn().mockImplementation((session: string) => {
        if (session === 'meshtastic') return Promise.resolve(opts.meshtasticBle === true);
        if (session === 'meshcore') return Promise.resolve(opts.meshcoreBle === true);
        return Promise.resolve(false);
      });
  window.electronAPI = {
    ...window.electronAPI,
    getPlatform: vi.fn().mockReturnValue(opts.platform ?? 'darwin'),
    getProcessUptimeSec,
    isNobleBleConnected,
    restartApp: vi.fn().mockResolvedValue(undefined),
    notify: {
      show: vi.fn().mockResolvedValue(undefined),
      longSessionRestart: vi.fn().mockResolvedValue(undefined),
      clearLongSessionNudge: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('useLongSessionMaintenance', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it('does not show before four-day uptime with BLE on darwin', async () => {
    mockApi({ platform: 'darwin', uptimeSec: FOUR_DAYS - 60, meshcoreBle: true });
    const { result } = renderHook(() => useLongSessionMaintenance());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.visible).toBe(false);
    expect(window.electronAPI.notify.longSessionRestart).not.toHaveBeenCalled();
  });

  it('shows banner and OS notify after four days with Noble BLE on darwin', async () => {
    mockApi({ platform: 'darwin', uptimeSec: FOUR_DAYS, meshcoreBle: true });
    const { result } = renderHook(() => useLongSessionMaintenance());
    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });
    expect(window.electronAPI.notify.longSessionRestart).toHaveBeenCalledWith({
      title: 'longSession.title',
      body: 'longSession.body',
      restartLabel: 'longSession.restart',
      laterLabel: 'longSession.dismiss',
    });
  });

  it('shows on win32 with meshtastic BLE', async () => {
    mockApi({ platform: 'win32', uptimeSec: FOUR_DAYS, meshtasticBle: true });
    const { result } = renderHook(() => useLongSessionMaintenance());
    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });
  });

  it('does not show for Serial/TCP-only (no Noble)', async () => {
    mockApi({
      platform: 'darwin',
      uptimeSec: FOUR_DAYS,
      meshtasticBle: false,
      meshcoreBle: false,
    });
    const { result } = renderHook(() => useLongSessionMaintenance());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.visible).toBe(false);
  });

  it('does not show on linux even with BLE', async () => {
    mockApi({ platform: 'linux', uptimeSec: FOUR_DAYS, meshcoreBle: true });
    const { result } = renderHook(() => useLongSessionMaintenance());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.visible).toBe(false);
  });

  it('shows after Noble connects later while already past four days', async () => {
    mockApi({
      platform: 'darwin',
      uptimeSec: FOUR_DAYS,
      meshtasticBle: false,
      meshcoreBle: false,
    });
    const { result } = renderHook(() => useLongSessionMaintenance());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.visible).toBe(false);

    vi.mocked(window.electronAPI.isNobleBleConnected).mockImplementation((session) => {
      return Promise.resolve(session === 'meshcore');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MS_PER_HOUR_FAKE);
    });
    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });
  });

  it('hides and clears OS cues when BLE drops', async () => {
    mockApi({ platform: 'darwin', uptimeSec: FOUR_DAYS, meshcoreBle: true });
    const { result } = renderHook(() => useLongSessionMaintenance());
    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });

    vi.mocked(window.electronAPI.isNobleBleConnected).mockResolvedValue(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MS_PER_HOUR_FAKE);
    });
    await waitFor(() => {
      expect(result.current.visible).toBe(false);
    });
    expect(window.electronAPI.notify.clearLongSessionNudge).toHaveBeenCalled();
  });

  it('suppresses remount within 12h of dismiss', async () => {
    mockApi({ platform: 'darwin', uptimeSec: FOUR_DAYS, meshcoreBle: true });
    sessionStorage.setItem(
      longSessionMaintenanceTestApi.DISMISSED_AT_KEY,
      String(Date.now() - 60_000),
    );
    const { result } = renderHook(() => useLongSessionMaintenance());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.visible).toBe(false);
  });

  it('dismiss stores timestamp and clears OS nudge', async () => {
    mockApi({ platform: 'darwin', uptimeSec: FOUR_DAYS, meshcoreBle: true });
    const { result } = renderHook(() => useLongSessionMaintenance());
    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });
    await act(async () => {
      result.current.onDismiss();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.visible).toBe(false);
    });
    expect(sessionStorage.getItem(longSessionMaintenanceTestApi.DISMISSED_AT_KEY)).toBeTruthy();
    expect(window.electronAPI.notify.clearLongSessionNudge).toHaveBeenCalled();
  });

  it('re-prompts after 12h dismiss window when still gated', async () => {
    mockApi({ platform: 'darwin', uptimeSec: FOUR_DAYS, meshcoreBle: true });
    sessionStorage.setItem(
      longSessionMaintenanceTestApi.DISMISSED_AT_KEY,
      String(Date.now() - TWELVE_H_MS - 1_000),
    );
    const { result } = renderHook(() => useLongSessionMaintenance());
    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });
  });

  it('restart clears OS then calls restartApp', async () => {
    mockApi({ platform: 'darwin', uptimeSec: FOUR_DAYS, meshcoreBle: true });
    const { result } = renderHook(() => useLongSessionMaintenance());
    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });
    await act(async () => {
      result.current.onRestart();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(window.electronAPI.notify.clearLongSessionNudge).toHaveBeenCalled();
      expect(window.electronAPI.restartApp).toHaveBeenCalled();
    });
  });

  it('survives getProcessUptimeSec rejection', async () => {
    mockApi({ platform: 'darwin', meshcoreBle: true, uptimeReject: true });
    const { result } = renderHook(() => useLongSessionMaintenance());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.visible).toBe(false);
  });
});
