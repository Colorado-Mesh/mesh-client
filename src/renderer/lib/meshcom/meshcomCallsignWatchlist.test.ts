import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAppSettingsRaw, mergeAppSetting } = vi.hoisted(() => ({
  getAppSettingsRaw: vi.fn((): string | null => null),
  mergeAppSetting: vi.fn((key: string, value: unknown) => {
    const prev = JSON.parse(getAppSettingsRaw() ?? '{}') as Record<string, unknown>;
    prev[key] = value;
    getAppSettingsRaw.mockReturnValue(JSON.stringify(prev));
  }),
}));

vi.mock('../appSettingsStorage', () => ({
  getAppSettingsRaw,
  mergeAppSetting,
}));

vi.mock('../chatNotifications', () => ({
  playMessageNotification: vi.fn(),
}));

vi.mock('../desktopNotification', () => ({
  fireNotification: vi.fn(),
}));

vi.mock('../i18n', () => ({
  default: { t: (key: string, opts?: { callsign?: string }) => `${key}:${opts?.callsign ?? ''}` },
}));

import {
  getMeshcomCallsignWatchlist,
  isMeshcomWatchlistCallsign,
  maybeAlertMeshcomWatchlistCallsign,
  meshcomWatchlistBaseCall,
  resetMeshcomCallsignWatchlistAlertsForTests,
  saveMeshcomCallsignWatchlist,
} from './meshcomCallsignWatchlist';

describe('meshcomCallsignWatchlist', () => {
  beforeEach(() => {
    resetMeshcomCallsignWatchlistAlertsForTests();
    getAppSettingsRaw.mockReturnValue(null);
    mergeAppSetting.mockClear();
    vi.stubGlobal('window', {
      electronAPI: {
        appSettings: {
          set: vi.fn(() => Promise.resolve({ changes: 1 })),
          getAll: vi.fn(() => Promise.resolve({})),
        },
      },
    });
  });

  it('strips SSID for base call matching', () => {
    expect(meshcomWatchlistBaseCall('oe1abc-9')).toBe('OE1ABC');
    expect(meshcomWatchlistBaseCall('OE1ABC')).toBe('OE1ABC');
  });

  it('persists and matches watchlist entries', async () => {
    await saveMeshcomCallsignWatchlist(['oe1abc-2', 'OE1ABC-9', 'dl1xyz']);
    expect(getMeshcomCallsignWatchlist()).toEqual(['OE1ABC', 'DL1XYZ']);
    expect(isMeshcomWatchlistCallsign('OE1ABC-99')).toBe(true);
    expect(isMeshcomWatchlistCallsign('W1AW-1')).toBe(false);
  });

  it('alerts once per cooldown window', async () => {
    const { playMessageNotification } = await import('../chatNotifications');
    const { fireNotification } = await import('../desktopNotification');
    await saveMeshcomCallsignWatchlist(['OE1ABC']);
    expect(maybeAlertMeshcomWatchlistCallsign('OE1ABC-1')).toBe(true);
    expect(maybeAlertMeshcomWatchlistCallsign('OE1ABC-2')).toBe(false);
    expect(playMessageNotification).toHaveBeenCalledWith('dm');
    expect(fireNotification).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      silent: false,
    });
  });

  it('skips sound when notifications are muted but still fires a silent OS notify', async () => {
    const { playMessageNotification } = await import('../chatNotifications');
    const { fireNotification } = await import('../desktopNotification');
    const { CHAT_NOTIF_MUTED_STORAGE_KEY } = await import('../chatInactiveNotifications');
    vi.mocked(playMessageNotification).mockClear();
    vi.mocked(fireNotification).mockClear();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
    localStorage.setItem(CHAT_NOTIF_MUTED_STORAGE_KEY, '1');
    await saveMeshcomCallsignWatchlist(['OE1ABC']);
    expect(maybeAlertMeshcomWatchlistCallsign('OE1ABC-1')).toBe(true);
    expect(playMessageNotification).not.toHaveBeenCalled();
    expect(fireNotification).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      silent: true,
    });
  });
});
