import { describe, expect, it } from 'vitest';

import {
  type DetectedFlashDevice,
  type DeviceFlashBoard,
  getDeviceFlashBoardById,
} from './deviceFirmwareBoards';
import { evaluateFlashPreflight, FLASH_MIN_BATTERY_PERCENT } from './deviceFirmwarePreflight';

function board(id: string): DeviceFlashBoard {
  const found = getDeviceFlashBoardById(id);
  if (!found) throw new Error(id);
  return found;
}

const heltec = board('meshtastic:heltec-v3');
const rak = board('meshtastic:rak4631');

function device(overrides: Partial<DetectedFlashDevice> = {}): DetectedFlashDevice {
  return {
    protocol: 'meshtastic',
    isConnected: true,
    connectionType: 'ble',
    batteryPercent: 90,
    batteryCharging: false,
    ...overrides,
  };
}

const ready = {
  device: device(),
  detection: { status: 'matched', board: heltec } as const,
  selectedBoard: heltec,
  hasImage: true,
  acknowledged: true,
};

describe('evaluateFlashPreflight', () => {
  it('allows flashing when everything checks out', () => {
    const result = evaluateFlashPreflight(ready);
    expect(result.canFlash).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining(['cable', 'espBootloader', 'settingsReset', 'connectionDrops']),
    );
  });

  it('blocks when the connected radio is not a supported board', () => {
    const result = evaluateFlashPreflight({
      ...ready,
      detection: { status: 'unsupported', reported: 'T-Echo' },
      selectedBoard: heltec,
    });
    expect(result.canFlash).toBe(false);
    expect(result.blockers).toContain('boardUnsupported');
  });

  it('blocks when the selection disagrees with the live detection', () => {
    const result = evaluateFlashPreflight({ ...ready, selectedBoard: rak });
    expect(result.blockers).toContain('boardMismatch');
    expect(result.canFlash).toBe(false);
  });

  it('requires a board, an image, and the acknowledgement', () => {
    const result = evaluateFlashPreflight({
      ...ready,
      detection: { status: 'unknown' },
      selectedBoard: null,
      hasImage: false,
      acknowledged: false,
    });
    expect(result.blockers).toEqual(
      expect.arrayContaining(['noBoard', 'noImage', 'notAcknowledged']),
    );
    expect(result.warnings).toContain('unverifiedBoard');
  });

  it('blocks while the app holds the USB serial connection', () => {
    const result = evaluateFlashPreflight({
      ...ready,
      device: device({ connectionType: 'serial' }),
    });
    expect(result.blockers).toContain('serialConnectionOpen');
    expect(result.warnings).not.toContain('connectionDrops');
  });

  it('blocks on low battery unless charging; warns when battery is unknown', () => {
    expect(
      evaluateFlashPreflight({
        ...ready,
        device: device({ batteryPercent: FLASH_MIN_BATTERY_PERCENT - 1 }),
      }).blockers,
    ).toContain('lowBattery');
    expect(
      evaluateFlashPreflight({
        ...ready,
        device: device({ batteryPercent: FLASH_MIN_BATTERY_PERCENT - 1, batteryCharging: true }),
      }).blockers,
    ).not.toContain('lowBattery');
    expect(
      evaluateFlashPreflight({
        ...ready,
        device: device({ batteryPercent: FLASH_MIN_BATTERY_PERCENT }),
      }).blockers,
    ).not.toContain('lowBattery');
    const unknown = evaluateFlashPreflight({ ...ready, device: device({ batteryPercent: null }) });
    expect(unknown.warnings).toContain('batteryUnknown');
    expect(unknown.canFlash).toBe(true);
  });

  it('uses the nRF52 bootloader warning and omits the settings-reset warning for DFU boards', () => {
    const result = evaluateFlashPreflight({
      ...ready,
      detection: { status: 'matched', board: rak },
      selectedBoard: rak,
    });
    expect(result.warnings).toContain('nrf52Bootloader');
    expect(result.warnings).not.toContain('espBootloader');
    expect(result.warnings).not.toContain('settingsReset');
  });

  it('ignores a stale low-battery reading when disconnected', () => {
    const result = evaluateFlashPreflight({
      ...ready,
      device: device({ isConnected: false, batteryPercent: 5 }),
      detection: { status: 'unknown' },
    });
    expect(result.blockers).not.toContain('lowBattery');
  });
});
