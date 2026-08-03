import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/appSettingsStorage', () => ({
  getAppSettingsRaw: vi.fn(() => null),
  mergeAppSetting: vi.fn(),
}));

import { getAppSettingsRaw, mergeAppSetting } from '../lib/appSettingsStorage';
import { useTimeFormatStore } from './timeFormatStore';

describe('timeFormatStore', () => {
  beforeEach(() => {
    vi.mocked(getAppSettingsRaw).mockReturnValue(null);
    vi.mocked(mergeAppSetting).mockClear();
    useTimeFormatStore.setState({ use24HourTime: false });
  });

  it('setUse24HourTime persists and updates state', () => {
    useTimeFormatStore.getState().setUse24HourTime(true);
    expect(useTimeFormatStore.getState().use24HourTime).toBe(true);
    expect(mergeAppSetting).toHaveBeenCalledWith(
      'use24HourTime',
      true,
      'timeFormatStore setUse24HourTime',
    );
  });

  it('hydrateFromSqlite wins over stale localStorage-backed state', () => {
    useTimeFormatStore.setState({ use24HourTime: false });
    useTimeFormatStore.getState().hydrateFromSqlite(true);
    expect(useTimeFormatStore.getState().use24HourTime).toBe(true);
    expect(mergeAppSetting).toHaveBeenCalledWith(
      'use24HourTime',
      true,
      'timeFormatStore hydrateFromSqlite',
    );
  });

  it('hydrateFromSqlite can clear a stale true from localStorage', () => {
    useTimeFormatStore.setState({ use24HourTime: true });
    useTimeFormatStore.getState().hydrateFromSqlite(false);
    expect(useTimeFormatStore.getState().use24HourTime).toBe(false);
    expect(mergeAppSetting).toHaveBeenCalledWith(
      'use24HourTime',
      false,
      'timeFormatStore hydrateFromSqlite',
    );
  });
});
