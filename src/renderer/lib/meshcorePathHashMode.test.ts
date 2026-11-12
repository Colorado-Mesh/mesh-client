import { afterEach, describe, expect, it, vi } from 'vitest';

import * as appSettingsStorage from './appSettingsStorage';
import {
  appPanelSettingsPersistPayload,
  buildSetPathHashModeFrame,
  parsePathHashModeFromDeviceQuery,
  resolveMeshcoreCompanionPathHashMode,
  setMeshcorePathHashModeOnRadio,
} from './meshcorePathHashMode';

describe('meshcorePathHashMode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds CMD 61 frame', () => {
    expect(Array.from(buildSetPathHashModeFrame(1))).toEqual([61, 0, 1]);
  });

  it('prefers runtime path.hash.mode over settings', () => {
    vi.spyOn(appSettingsStorage, 'getAppSettingsRaw').mockReturnValue(
      JSON.stringify({ meshcorePathHashMode: 0 }),
    );
    expect(resolveMeshcoreCompanionPathHashMode(2)).toBe(2);
  });

  it('falls back to Radio settings when runtime mode is not adopted yet', () => {
    vi.spyOn(appSettingsStorage, 'getAppSettingsRaw').mockReturnValue(
      JSON.stringify({ meshcorePathHashMode: 1 }),
    );
    expect(resolveMeshcoreCompanionPathHashMode(null)).toBe(1);
  });

  it('omits meshcorePathHashMode and Open-wire from AppPanel persist', () => {
    const settings = {
      chatCompactMode: true,
      meshcorePathHashMode: 0,
      meshcoreOpenWireCompatEnabled: true,
    };
    expect(appPanelSettingsPersistPayload(settings)).toEqual({ chatCompactMode: true });
  });

  it('leaves translation preferences to their live settings owner', () => {
    expect(
      appPanelSettingsPersistPayload({
        chatCompactMode: true,
        aiEnabled: false,
        translationEnabled: false,
        translationTargetLanguage: 'en',
        translationReadLanguages: ['en'],
        translationAutoEnabled: false,
        translationLibreEnabled: false,
        translationLibreUrl: '',
      }),
    ).toEqual({ chatCompactMode: true });
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
