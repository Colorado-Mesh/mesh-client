import { create } from 'zustand';

import { getAppSettingsRaw, mergeAppSetting } from '../lib/appSettingsStorage';
import type { CoordinateFormat } from '../lib/coordUtils';
import { parseStoredJson } from '../lib/parseStoredJson';

function loadCoordinateFormat(): CoordinateFormat {
  const o = parseStoredJson<{ coordinateFormat?: string }>(
    getAppSettingsRaw(),
    'coordFormatStore loadCoordinateFormat',
  );
  return o?.coordinateFormat === 'mgrs' ? 'mgrs' : 'decimal';
}

interface CoordFormatState {
  coordinateFormat: CoordinateFormat;
  setCoordinateFormat(format: CoordinateFormat): void;
}

export const useCoordFormatStore = create<CoordFormatState>((set) => ({
  coordinateFormat: loadCoordinateFormat(),
  setCoordinateFormat(format) {
    mergeAppSetting('coordinateFormat', format, 'coordFormatStore setCoordinateFormat');
    set({ coordinateFormat: format });
  },
}));
