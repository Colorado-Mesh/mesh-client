/**
 * Flash orchestration for Meshtastic / MeshCore device firmware. Re-validates the plan against
 * its board immediately before touching hardware, then delegates to the shared RNode flashers
 * (`esp32Flasher` / `nrf52DfuFlasher`). The ESP32 path additionally verifies the chip reported
 * by the ROM bootloader before the first byte is written.
 */
import { closeSerialPortIfOpen } from '@/renderer/lib/connection';

import type { DeviceFlashBoard, DeviceFlashFamily } from './deviceFirmwareBoards';
import {
  DeviceFirmwareError,
  type DeviceFirmwarePlan,
  ESP_IMAGE_CHIP_ID,
  parseEspImageHeader,
} from './deviceFirmwareImage';
import { flashEsp32Images } from './esp32Flasher';
import { Nrf52DfuFlasher } from './nrf52DfuFlasher';
import type { FlashProgressCallback } from './types';

/** esptool-js `CHIP_NAME` expected for each board family (`null` for non-ESP families). */
export function expectedEspChipName(family: DeviceFlashFamily): string | null {
  if (family === 'esp32') return 'ESP32';
  if (family === 'esp32s3') return 'ESP32-S3';
  return null;
}

export interface RunDeviceFirmwareFlashOptions {
  progressCallback?: FlashProgressCallback;
  signal?: AbortSignal;
}

/** Last-line checks on an already planned image; throws instead of flashing a mismatch. */
export function assertPlanMatchesBoard(plan: DeviceFirmwarePlan, board: DeviceFlashBoard): void {
  if (plan.board.id !== board.id) throw new DeviceFirmwareError('IMAGE_BOARD_MISMATCH');
  if (plan.kind === 'esp32') {
    if (board.family === 'nrf52840') throw new DeviceFirmwareError('IMAGE_CHIP_MISMATCH');
    const expectedChipId = ESP_IMAGE_CHIP_ID[board.family];
    for (const image of plan.images) {
      if (parseEspImageHeader(image.data)?.chipId !== expectedChipId) {
        throw new DeviceFirmwareError('IMAGE_CHIP_MISMATCH');
      }
    }
  } else if (board.family !== 'nrf52840') {
    throw new DeviceFirmwareError('IMAGE_CHIP_MISMATCH');
  }
}

/**
 * Flash `plan` to the device on `port`. The caller owns the port lifecycle (closing it in a
 * `finally`). Cancellation rejects with `ESP32_FLASH_CANCELLED` / `NRF52_DFU_CANCELLED`.
 */
export async function runDeviceFirmwareFlash(
  port: SerialPort,
  plan: DeviceFirmwarePlan,
  options: RunDeviceFirmwareFlashOptions = {},
): Promise<void> {
  assertPlanMatchesBoard(plan, plan.board);
  const { progressCallback, signal } = options;

  if (plan.kind === 'esp32') {
    const expectedChipName = expectedEspChipName(plan.board.family);
    if (!expectedChipName) throw new DeviceFirmwareError('IMAGE_CHIP_MISMATCH');
    await flashEsp32Images(port, plan.images, {
      // Keep the image's own header (mode/freq/size) — it was built for this exact board.
      flashSize: 'keep',
      flashMode: 'keep',
      flashFreq: 'keep',
      expectedChipName,
      skipRNodePrepare: true,
      progressCallback,
      signal,
    });
    return;
  }

  await closeSerialPortIfOpen(port);
  const flasher = new Nrf52DfuFlasher(port);
  await flasher.flash(
    new Blob([plan.dfuPackage as BlobPart], { type: 'application/zip' }),
    progressCallback,
    { signal },
  );
}
