import type { FileEntry } from '@zip.js/zip.js';
import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';
import type { FlashSizeValues } from 'esptool-js';
import { ESPLoader, Transport } from 'esptool-js';

import { closeSerialPortIfOpen } from '@/renderer/lib/connection';
import { FIRMWARE_BACKUP_MAX_BYTES } from '@/shared/firmwareBackup';

import { blobToUint8Array, parseFlashAddress, sleepMillis } from './binaryUtils';
import { forceEsp32DownloadMode } from './esp32BootloaderEntry';
import { md5HexBytes } from './md5';
import { prepareEsp32PortForFlash } from './prepareEsp32PortForFlash';
import type { Esp32FlashConfig, FlashProgressCallback } from './types';

const ESP32_FLASH_BAUD = 921600;
/** Abort hung esptool sync (UI otherwise stays at 0% indefinitely). */
const ESP32_SYNC_TIMEOUT_MS = 45_000;
const ESP32_SYNC_MAX_ATTEMPTS = 3;
/** Abort writeFlash when no bytes progress (USB drop mid-transfer). */
const ESP32_FLASH_STALL_TIMEOUT_MS = 60_000;
/** Reject instant "success" when almost no firmware bytes were written. */
const MIN_FLASH_BYTES_WRITTEN = 8192;

function createEsploader(transport: Transport): ESPLoader {
  return new ESPLoader({
    transport,
    baudrate: ESP32_FLASH_BAUD,
    debugLogging: false,
    enableTracing: false,
    terminal: {
      clean() {
        // catch-no-log-ok esptool-js terminal interface requires clean()
      },
      writeLine(data: string) {
        console.debug('[esptool]', data);
      },
      write(data: string) {
        console.debug('[esptool]', data);
      },
    },
  });
}

async function runEsp32MainWithTimeout(
  esploader: ESPLoader,
  serialPort: SerialPort,
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      esploader.main(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('ESP32_SYNC_TIMEOUT'));
        }, ESP32_SYNC_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    await closeSerialPortIfOpen(serialPort);
    const message = e instanceof Error ? e.message : String(e);
    if (message === 'ESP32_SYNC_TIMEOUT' || message === 'Failed to connect with the device') {
      throw new Error('ESP32_SYNC_FAILED');
    }
    throw e;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function connectEsp32Bootloader(
  serialPort: SerialPort,
  progressCallback?: FlashProgressCallback,
): Promise<{ esploader: ESPLoader; transport: Transport }> {
  await prepareEsp32PortForFlash(serialPort);

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= ESP32_SYNC_MAX_ATTEMPTS; attempt++) {
    await forceEsp32DownloadMode(serialPort, attempt > 1);
    const transport = new Transport(serialPort, true);
    const esploader = createEsploader(transport);
    progressCallback?.(0);

    try {
      await runEsp32MainWithTimeout(esploader, serialPort);
      return { esploader, transport };
    } catch (e) {
      // catch-no-log-ok sync retries collect lastError; failure thrown after loop
      lastError = e instanceof Error ? e : new Error(String(e));
      if (lastError.message !== 'ESP32_SYNC_FAILED' || attempt >= ESP32_SYNC_MAX_ATTEMPTS) {
        break;
      }
    }
  }

  throw lastError ?? new Error('ESP32_SYNC_FAILED');
}

export async function flashEsp32Firmware(
  serialPort: SerialPort,
  firmwareZip: Blob,
  flashConfig: Esp32FlashConfig,
  progressCallback?: FlashProgressCallback,
): Promise<void> {
  await closeSerialPortIfOpen(serialPort);

  const blobReader = new BlobReader(firmwareZip);
  const zipReader = new ZipReader(blobReader);
  try {
    const zipEntries = await zipReader.getEntries();

    const filesToFlash: { address: number; data: Uint8Array }[] = [];
    for (const [address, filename] of Object.entries(flashConfig.flash_files)) {
      const entry = zipEntries.find(
        (zipEntry): zipEntry is FileEntry => !zipEntry.directory && zipEntry.filename === filename,
      );
      if (!entry) {
        throw new Error(`${filename} not found in firmware file`);
      }
      const blob = await entry.getData(new BlobWriter('application/octet-stream'));
      const data = await blobToUint8Array(blob);
      filesToFlash.push({ address: parseFlashAddress(address), data });
    }

    const totalFirmwareBytes = filesToFlash.reduce((sum, file) => sum + file.data.byteLength, 0);
    let maxBytesWritten = 0;

    const { esploader, transport } = await connectEsp32Bootloader(serialPort, progressCallback);

    const chipName =
      (esploader as { chip?: { CHIP_NAME?: string } }).chip?.CHIP_NAME ??
      (esploader as { chipName?: string }).chipName ??
      '';
    if (!chipName) {
      throw new Error('ESP32_SYNC_FAILED');
    }

    let lastProgressAt = Date.now();
    let hasSeenProgress = false;
    let stallInterval: ReturnType<typeof setInterval> | undefined;

    try {
      await Promise.race([
        esploader.writeFlash({
          fileArray: filesToFlash,
          flashSize: flashConfig.flash_size,
          flashMode: 'dio',
          flashFreq: '80m',
          eraseAll: false,
          compress: true,
          calculateMD5Hash: (image: Uint8Array) => md5HexBytes(image),
          reportProgress: (_fileIndex: number, written: number, total: number) => {
            hasSeenProgress = true;
            lastProgressAt = Date.now();
            maxBytesWritten = Math.max(maxBytesWritten, written);
            progressCallback?.(Math.floor((written / total) * 100));
          },
        }),
        new Promise<never>((_, reject) => {
          stallInterval = setInterval(() => {
            if (!hasSeenProgress) {
              return;
            }
            if (Date.now() - lastProgressAt >= ESP32_FLASH_STALL_TIMEOUT_MS) {
              console.warn('[esp32Flasher] writeFlash stalled — closing serial port');
              void closeSerialPortIfOpen(serialPort);
              reject(new Error('ESP32_FLASH_STALLED'));
            }
          }, 2000);
        }),
      ]);
    } finally {
      if (stallInterval) {
        clearInterval(stallInterval);
      }
    }

    if (
      totalFirmwareBytes >= MIN_FLASH_BYTES_WRITTEN &&
      maxBytesWritten < MIN_FLASH_BYTES_WRITTEN
    ) {
      throw new Error('FLASH_TRANSFER_TOO_SMALL');
    }

    // Meshchat parity: DTR pulse reboot after writeFlash, then close port cleanly.
    await transport.setDTR(false);
    await sleepMillis(100);
    await transport.setDTR(true);
    await sleepMillis(1500);

    try {
      await transport.disconnect();
    } catch {
      // catch-no-log-ok port may already be closed
    }
    await closeSerialPortIfOpen(serialPort);
  } finally {
    try {
      await zipReader.close();
    } catch {
      // catch-no-log-ok zip may already be closed after successful flash
    }
  }
}

export interface Esp32FlashReadOptions {
  /** Catalog flash size (e.g. `'4MB'`) used when the JEDEC size byte is unrecognized. */
  fallbackFlashSize?: string;
  progressCallback?: FlashProgressCallback;
  signal?: AbortSignal;
}

export interface Esp32FlashReadResult {
  data: Uint8Array;
  chipName: string;
  flashSizeBytes: number;
}

function resolveEsp32FlashSizeBytes(
  esploader: ESPLoader,
  flashId: number,
  fallbackFlashSize: string | undefined,
): number {
  const sizeId = (flashId >> 16) & 0xff;
  const detected = (esploader.DETECTED_FLASH_SIZES as Record<number, string | undefined>)[sizeId];
  const label = detected ?? fallbackFlashSize ?? '4MB';
  const bytes = esploader.flashSizeBytes(label as FlashSizeValues);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw new Error('ESP32_FLASH_SIZE_UNKNOWN');
  }
  return Math.min(bytes, FIRMWARE_BACKUP_MAX_BYTES);
}

/**
 * Read the entire ESP32 flash (bootloader, partitions, app, and RNode EEPROM/config sectors)
 * as a restorable image. Cancellation closes the serial port so esptool's pending read rejects;
 * the caller should treat `ESP32_READ_CANCELLED` as a user action, not a failure.
 */
export async function readEsp32Flash(
  serialPort: SerialPort,
  options: Esp32FlashReadOptions = {},
): Promise<Esp32FlashReadResult> {
  const { fallbackFlashSize, progressCallback, signal } = options;
  if (signal?.aborted) throw new Error('ESP32_READ_CANCELLED');
  await closeSerialPortIfOpen(serialPort);

  const { esploader, transport } = await connectEsp32Bootloader(serialPort, progressCallback);

  let stallInterval: ReturnType<typeof setInterval> | undefined;
  let rejectOnAbort: (() => void) | undefined;
  try {
    const chipName =
      (esploader as { chip?: { CHIP_NAME?: string } }).chip?.CHIP_NAME ??
      (esploader as { chipName?: string }).chipName ??
      '';
    if (!chipName) {
      throw new Error('ESP32_SYNC_FAILED');
    }

    const flashSizeBytes = resolveEsp32FlashSizeBytes(
      esploader,
      await esploader.readFlashId(),
      fallbackFlashSize,
    );

    let lastProgressAt = Date.now();
    const data = await Promise.race([
      esploader.readFlash(0, flashSizeBytes, (_packet, progress, totalSize) => {
        lastProgressAt = Date.now();
        progressCallback?.(Math.floor((progress / totalSize) * 100));
      }),
      new Promise<never>((_, reject) => {
        stallInterval = setInterval(() => {
          if (Date.now() - lastProgressAt >= ESP32_FLASH_STALL_TIMEOUT_MS) {
            console.warn('[esp32Flasher] readFlash stalled — closing serial port');
            void closeSerialPortIfOpen(serialPort);
            reject(new Error('ESP32_READ_STALLED'));
          }
        }, 2000);
      }),
      new Promise<never>((_, reject) => {
        if (!signal) return;
        rejectOnAbort = () => {
          void closeSerialPortIfOpen(serialPort);
          reject(new Error('ESP32_READ_CANCELLED'));
        };
        if (signal.aborted) rejectOnAbort();
        else signal.addEventListener('abort', rejectOnAbort, { once: true });
      }),
    ]);

    if (data.byteLength !== flashSizeBytes) {
      throw new Error('ESP32_READ_INCOMPLETE');
    }

    await transport.setDTR(false);
    await sleepMillis(100);
    await transport.setDTR(true);
    await sleepMillis(1500);

    return { data, chipName, flashSizeBytes };
  } finally {
    if (stallInterval) clearInterval(stallInterval);
    if (signal && rejectOnAbort) signal.removeEventListener('abort', rejectOnAbort);
    try {
      await transport.disconnect();
    } catch {
      // catch-no-log-ok port may already be closed
    }
    await closeSerialPortIfOpen(serialPort);
  }
}
