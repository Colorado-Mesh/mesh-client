/**
 * Pre-flash gate shared by Meshtastic and MeshCore. Produces blocking errors (flash button stays
 * disabled) and advisory warnings (always shown, never dismissible). Pure — no I/O.
 */
import {
  type BoardDetection,
  type DetectedFlashDevice,
  type DeviceFlashBoard,
  type DeviceFlashFamily,
} from './deviceFirmwareBoards';

/** Refuse to start below this battery level unless the device reports it is charging. */
export const FLASH_MIN_BATTERY_PERCENT = 30;

export type PreflightBlockerId =
  | 'noBoard'
  | 'boardUnsupported'
  | 'boardMismatch'
  | 'serialConnectionOpen'
  | 'lowBattery'
  | 'noImage'
  | 'notAcknowledged';

export type PreflightWarningId =
  | 'cable'
  | 'batteryUnknown'
  | 'espBootloader'
  | 'nrf52Bootloader'
  | 'settingsReset'
  | 'connectionDrops'
  | 'unverifiedBoard';

export interface PreflightInput {
  device: DetectedFlashDevice;
  detection: BoardDetection;
  /** Board chosen in the UI (locked to the detected one when detection matched). */
  selectedBoard: DeviceFlashBoard | null;
  hasImage: boolean;
  /** User ticked the "I confirm this is the right device / I have a backup" checkbox. */
  acknowledged: boolean;
}

export interface PreflightResult {
  blockers: PreflightBlockerId[];
  warnings: PreflightWarningId[];
  canFlash: boolean;
}

function bootloaderWarning(family: DeviceFlashFamily): PreflightWarningId {
  return family === 'nrf52840' ? 'nrf52Bootloader' : 'espBootloader';
}

export function evaluateFlashPreflight(input: PreflightInput): PreflightResult {
  const { device, detection, selectedBoard, hasImage, acknowledged } = input;
  const blockers: PreflightBlockerId[] = [];
  const warnings: PreflightWarningId[] = [];

  if (detection.status === 'unsupported') {
    blockers.push('boardUnsupported');
  } else if (!selectedBoard) {
    blockers.push('noBoard');
  } else if (detection.status === 'matched' && detection.board.id !== selectedBoard.id) {
    // Selection is locked to the live radio; reaching here means a stale/forged selection.
    blockers.push('boardMismatch');
  }

  // The app holds the USB serial port while connected; flashing would yank the live link.
  if (device.isConnected && device.connectionType === 'serial') {
    blockers.push('serialConnectionOpen');
  }

  const battery = device.batteryPercent;
  if (
    device.isConnected &&
    typeof battery === 'number' &&
    battery < FLASH_MIN_BATTERY_PERCENT &&
    device.batteryCharging !== true
  ) {
    blockers.push('lowBattery');
  } else if (typeof battery !== 'number') {
    warnings.push('batteryUnknown');
  }

  if (!hasImage) blockers.push('noImage');
  if (!acknowledged) blockers.push('notAcknowledged');

  warnings.push('cable');
  if (selectedBoard) warnings.push(bootloaderWarning(selectedBoard.family));
  // Full-flash ESP32 images rewrite NVS; the nRF52 DFU path replaces the app image only.
  if (selectedBoard && selectedBoard.family !== 'nrf52840') warnings.push('settingsReset');
  if (device.isConnected && device.connectionType !== 'serial') warnings.push('connectionDrops');
  if (detection.status === 'unknown') warnings.push('unverifiedBoard');

  return { blockers, warnings, canFlash: blockers.length === 0 };
}
