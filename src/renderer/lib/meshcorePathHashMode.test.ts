import { describe, expect, it, vi } from 'vitest';

import {
  appPanelSettingsPersistPayload,
  buildSetPathHashModeFrame,
  parsePathHashModeFromDeviceQuery,
  setMeshcorePathHashModeOnRadio,
} from './meshcorePathHashMode';

describe('meshcorePathHashMode', () => {
  it('builds CMD 61 frame', () => {
    expect(Array.from(buildSetPathHashModeFrame(1))).toEqual([61, 0, 1]);
  });

  it('omits meshcorePathHashMode from AppPanel persist unless user changed it', () => {
    const settings = { chatCompactMode: true, meshcorePathHashMode: 0 };
    expect(appPanelSettingsPersistPayload(settings, false)).toEqual({ chatCompactMode: true });
    expect(appPanelSettingsPersistPayload(settings, true)).toEqual(settings);
  });

  it('parses pathHashMode from deviceQuery payload', () => {
    expect(
      parsePathHashModeFromDeviceQuery({
        pathHashMode: 2,
        firmwareVersion: '1.14.0',
        manufacturerModel: 'Heltec_v3',
      }),
    ).toEqual({
      pathHashMode: 2,
      firmwareVersion: '1.14.0',
      manufacturerModel: 'Heltec_v3',
      clientRepeat: undefined,
    });
  });

  it('sets path hash mode and waits for Ok', async () => {
    const conn = {
      on: vi.fn((event: string | number, cb: () => void) => {
        if (event === 0) queueMicrotask(cb);
      }),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn().mockResolvedValue(undefined),
    };
    await setMeshcorePathHashModeOnRadio(conn, 1);
    expect(conn.sendToRadioFrame).toHaveBeenCalledWith(buildSetPathHashModeFrame(1));
  });
});
