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
});
