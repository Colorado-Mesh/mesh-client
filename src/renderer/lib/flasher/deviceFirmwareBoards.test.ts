import { describe, expect, it } from 'vitest';

import {
  buildDetectedFlashDevice,
  detectDeviceFlashBoard,
  type DetectedFlashDevice,
  DEVICE_FLASH_BOARDS,
  getDeviceFlashBoardById,
  getDeviceFlashBoards,
  normalizeModelKey,
} from './deviceFirmwareBoards';

function mt(hw: string | number | null | undefined, isConnected = true): DetectedFlashDevice {
  return { protocol: 'meshtastic', isConnected, meshtasticHwModel: hw };
}
function mc(model: string | null | undefined, isConnected = true): DetectedFlashDevice {
  return { protocol: 'meshcore', isConnected, meshcoreManufacturerModel: model };
}

describe('device flash board catalog', () => {
  it('has unique ids and a family for every board', () => {
    const ids = DEVICE_FLASH_BOARDS.map((board) => board.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const board of DEVICE_FLASH_BOARDS) {
      expect(['esp32', 'esp32s3', 'nrf52840']).toContain(board.family);
      expect(board.id.startsWith(`${board.protocol}:`)).toBe(true);
      if (board.family !== 'nrf52840') expect(board.flashBytes).toBeGreaterThan(0);
    }
  });

  it('keeps the matrix narrow: both protocols cover esp32s3 and nrf52840', () => {
    for (const protocol of ['meshtastic', 'meshcore'] as const) {
      const families = getDeviceFlashBoards(protocol).map((board) => board.family);
      expect(families).toContain('esp32s3');
      expect(families).toContain('nrf52840');
    }
    expect(getDeviceFlashBoards('meshtastic').some((board) => board.family === 'esp32')).toBe(true);
    expect(DEVICE_FLASH_BOARDS.length).toBeLessThanOrEqual(8);
  });

  it('looks boards up by id', () => {
    expect(getDeviceFlashBoardById('meshtastic:rak4631')?.family).toBe('nrf52840');
    expect(getDeviceFlashBoardById('nope')).toBeNull();
  });
});

describe('detectDeviceFlashBoard — Meshtastic', () => {
  it.each([
    ['43', 'meshtastic:heltec-v3'],
    [43, 'meshtastic:heltec-v3'],
    ['4', 'meshtastic:tbeam'],
    ['9', 'meshtastic:rak4631'],
  ])('matches hw_model %s', (hw, id) => {
    expect(detectDeviceFlashBoard(mt(hw))).toMatchObject({
      status: 'matched',
      board: { id },
    });
  });

  it('matches legacy branded labels stored instead of numbers', () => {
    expect(detectDeviceFlashBoard(mt('Heltec V3'))).toMatchObject({
      status: 'matched',
      board: { id: 'meshtastic:heltec-v3' },
    });
  });

  it('reports unsupported for known-but-unlisted hardware (fail closed)', () => {
    expect(detectDeviceFlashBoard(mt('7'))).toEqual({ status: 'unsupported', reported: 'T-Echo' });
    expect(detectDeviceFlashBoard(mt('132'))).toMatchObject({ status: 'unsupported' });
    expect(detectDeviceFlashBoard(mt('SOMETHING_ELSE'))).toEqual({
      status: 'unsupported',
      reported: 'SOMETHING_ELSE',
    });
  });

  it('is unknown (manual selection) when disconnected, unset, or empty', () => {
    expect(detectDeviceFlashBoard(mt('43', false))).toEqual({ status: 'unknown' });
    expect(detectDeviceFlashBoard(mt('0'))).toEqual({ status: 'unknown' });
    expect(detectDeviceFlashBoard(mt(''))).toEqual({ status: 'unknown' });
    expect(detectDeviceFlashBoard(mt(null))).toEqual({ status: 'unknown' });
    expect(detectDeviceFlashBoard(mt(undefined))).toEqual({ status: 'unknown' });
  });
});

describe('detectDeviceFlashBoard — MeshCore', () => {
  it.each([
    ['Heltec V3', 'meshcore:heltec-v3'],
    ['  heltec v3 ', 'meshcore:heltec-v3'],
    ['RAK 4631', 'meshcore:rak4631'],
    ['RAK4631', 'meshcore:rak4631'],
  ])('matches manufacturer model %j', (model, id) => {
    expect(detectDeviceFlashBoard(mc(model))).toMatchObject({ status: 'matched', board: { id } });
  });

  it('does not fuzzy-match near models (V3.2, V4) and reports them unsupported', () => {
    expect(detectDeviceFlashBoard(mc('Heltec V3.2'))).toEqual({
      status: 'unsupported',
      reported: 'Heltec V3.2',
    });
    expect(detectDeviceFlashBoard(mc('Heltec V4'))).toMatchObject({ status: 'unsupported' });
  });

  it('is unknown when disconnected or no model was reported', () => {
    expect(detectDeviceFlashBoard(mc('Heltec V3', false))).toEqual({ status: 'unknown' });
    expect(detectDeviceFlashBoard(mc(null))).toEqual({ status: 'unknown' });
    expect(detectDeviceFlashBoard(mc('   '))).toEqual({ status: 'unknown' });
  });

  it('normalizes model keys', () => {
    expect(normalizeModelKey('RAK 4631-A')).toBe('rak4631a');
  });
});

describe('buildDetectedFlashDevice', () => {
  const state = {
    connectionType: 'ble',
    firmwareVersion: '2.7.15',
    manufacturerModel: 'Heltec V3',
    batteryPercent: 80,
    batteryCharging: false,
  };

  it('routes the protocol-specific identity field', () => {
    expect(
      buildDetectedFlashDevice('meshtastic', { isConnected: true, state, meshtasticHwModel: '43' }),
    ).toMatchObject({
      protocol: 'meshtastic',
      meshtasticHwModel: '43',
      meshcoreManufacturerModel: null,
      batteryPercent: 80,
    });
    expect(buildDetectedFlashDevice('meshcore', { isConnected: true, state })).toMatchObject({
      protocol: 'meshcore',
      meshtasticHwModel: null,
      meshcoreManufacturerModel: 'Heltec V3',
    });
  });

  it('returns undefined for Reticulum (RNode flasher owns it)', () => {
    expect(buildDetectedFlashDevice('reticulum', { isConnected: true, state })).toBeUndefined();
  });
});
