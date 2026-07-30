import { create } from 'zustand';

import { getAppSettingsRaw, mergeAppSetting } from '../lib/appSettingsStorage';
import { parseStoredJson } from '../lib/parseStoredJson';

function loadUse24HourTime(): boolean {
  try {
    const o = parseStoredJson<{ use24HourTime?: boolean }>(
      getAppSettingsRaw(),
      'timeFormatStore loadUse24HourTime',
    );
    return o?.use24HourTime === true;
  } catch {
    // catch-no-log-ok: localStorage unavailable in node / restricted environments
    return false;
  }
}

interface TimeFormatState {
  use24HourTime: boolean;
  setUse24HourTime(value: boolean): void;
  /** Reconcile from SQLite `app_settings` when available (canonical after cold start). */
  hydrateFromSqlite(value: boolean): void;
}

export const useTimeFormatStore = create<TimeFormatState>((set) => ({
  use24HourTime: loadUse24HourTime(),
  setUse24HourTime(value) {
    mergeAppSetting('use24HourTime', value, 'timeFormatStore setUse24HourTime');
    set({ use24HourTime: value });
  },
  hydrateFromSqlite(value) {
    mergeAppSetting('use24HourTime', value, 'timeFormatStore hydrateFromSqlite');
    set({ use24HourTime: value });
  },
}));
