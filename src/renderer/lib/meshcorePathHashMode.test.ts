import { describe, expect, it, vi } from 'vitest';

import {
  buildSetPathHashModeFrame,
  parsePathHashModeFromDeviceQuery,
  setMeshcorePathHashModeOnRadio,
} from './meshcorePathHashMode';

describe('meshcorePathHashMode', () => {
  it('builds CMD 61 frame', () => {
    expect(Array.from(buildSetPathHashModeFrame(1))).toEqual([61, 0, 1]);
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
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn((event: string | number, cb: () => void) => {
        if (event === 0) queueMicrotask(cb);
      }),
      sendToRadioFrame: vi.fn().mockResolvedValue(undefined),
    };
    await setMeshcorePathHashModeOnRadio(conn, 1);
    expect(conn.sendToRadioFrame).toHaveBeenCalledWith(buildSetPathHashModeFrame(1));
  });
});
