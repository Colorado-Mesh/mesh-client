import type { FileEntry } from '@zip.js/zip.js';
import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';
import type { FlashFreqValues, FlashModeValues, FlashSizeValues } from 'esptool-js';
import { ESPLoader, Transport } from 'esptool-js';

import { closeSerialPortIfOpen } from '@/renderer/lib/connection';
import { FIRMWARE_BACKUP_MAX_BYTES } from '@/shared/firmwareBackup';
import { bytesToHex } from '@/shared/hexBytes';

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
/** Bound transport.disconnect so a stuck serial write cannot block cancel/stall cleanup. */
const ESP32_DISCONNECT_TIMEOUT_MS = 3_000;
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
  options: { skipRNodePrepare?: boolean } = {},
): Promise<{ esploader: ESPLoader; transport: Transport }> {
  if (options.skipRNodePrepare) {
    // Meshtastic / MeshCore boards are not RNodes — do not send KISS probes to them.
    await closeSerialPortIfOpen(serialPort);
  } else {
    await prepareEsp32PortForFlash(serialPort);
  }

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

    await flashEsp32Images(serialPort, filesToFlash, {
      flashSize: flashConfig.flash_size,
      progressCallback,
    });
  } finally {
    try {
      await zipReader.close();
    } catch {
      // catch-no-log-ok zip may already be closed after successful flash
    }
  }
}

export interface Esp32FlashImage {
  address: number;
  data: Uint8Array;
}

export interface Esp32FlashImagesOptions {
  flashSize: FlashSizeValues;
  /** Defaults to `dio` (RNode catalog behavior). Use `keep` to preserve the image header. */
  flashMode?: FlashModeValues;
  /** Defaults to `80m` (RNode catalog behavior). Use `keep` to preserve the image header. */
  flashFreq?: FlashFreqValues;
  progressCallback?: FlashProgressCallback;
  /** Cancellation closes the serial port; rejects with `ESP32_FLASH_CANCELLED`. */
  signal?: AbortSignal;
  /**
   * Fail closed: when set, the connected chip must report exactly this `CHIP_NAME`
   * (e.g. `ESP32-S3`) before any byte is written; otherwise `ESP32_CHIP_MISMATCH`.
   */
  expectedChipName?: string;
  /** Skip the RNode reset probe (non-RNode firmware such as Meshtastic / MeshCore). */
  skipRNodePrepare?: boolean;
}

function esp32ImagesEndBytes(images: readonly Esp32FlashImage[]): number {
  return images.reduce((max, image) => Math.max(max, image.address + image.data.byteLength), 0);
}

/** Disconnect the esptool Transport first; fall back to closing the SerialPort if needed. */
async function disconnectEsp32Transport(
  transport: Transport,
  serialPort: SerialPort,
): Promise<void> {
  try {
    // Do not await disconnect forever — a mid-write hang would block abort/stall cleanup.
    await Promise.race([transport.disconnect(), sleepMillis(ESP32_DISCONNECT_TIMEOUT_MS)]);
  } catch {
    // catch-no-log-ok port may already be closed
  }
  await closeSerialPortIfOpen(serialPort);
}

/**
 * Write already-extracted images at explicit flash addresses (shared by the RNode zip flow and
 * Meshtastic / MeshCore device firmware). Progress, MD5 verify, stall watchdog, and the
 * min-bytes sanity check are identical for every caller.
 */
export async function flashEsp32Images(
  serialPort: SerialPort,
  filesToFlash: readonly Esp32FlashImage[],
  options: Esp32FlashImagesOptions,
): Promise<void> {
  const {
    flashSize,
    flashMode = 'dio',
    flashFreq = '80m',
    progressCallback,
    signal,
    expectedChipName,
    skipRNodePrepare,
  } = options;
  if (signal?.aborted) throw new Error('ESP32_FLASH_CANCELLED');

  const totalFirmwareBytes = filesToFlash.reduce((sum, file) => sum + file.data.byteLength, 0);
  let maxBytesWritten = 0;

  const { esploader, transport } = await connectEsp32Bootloader(serialPort, progressCallback, {
    skipRNodePrepare,
  });

  const chipName =
    (esploader as { chip?: { CHIP_NAME?: string } }).chip?.CHIP_NAME ??
    (esploader as { chipName?: string }).chipName ??
    '';
  if (!chipName) {
    throw new Error('ESP32_SYNC_FAILED');
  }
  if (expectedChipName && chipName !== expectedChipName) {
    console.warn('[esp32Flasher] chip mismatch — refusing to write', {
      chipName,
      expectedChipName,
    });
    await disconnectEsp32Transport(transport, serialPort);
    throw new Error('ESP32_CHIP_MISMATCH');
  }
  if (expectedChipName) {
    // Never write an image that cannot fit the detected flash (JEDEC size byte); unknown sizes
    // fall back to the catalog bound the caller already validated.
    const sizeId = ((await esploader.readFlashId()) >> 16) & 0xff;
    const detected = (esploader.DETECTED_FLASH_SIZES as Record<number, string | undefined>)[sizeId];
    if (detected) {
      const detectedBytes = esploader.flashSizeBytes(detected as FlashSizeValues);
      if (Number.isFinite(detectedBytes) && esp32ImagesEndBytes(filesToFlash) > detectedBytes) {
        await disconnectEsp32Transport(transport, serialPort);
        throw new Error('ESP32_IMAGE_EXCEEDS_FLASH');
      }
    }
  }
  if (signal?.aborted) {
    await disconnectEsp32Transport(transport, serialPort);
    throw new Error('ESP32_FLASH_CANCELLED');
  }

  let lastProgressAt = Date.now();
  let hasSeenProgress = false;
  let stallInterval: ReturnType<typeof setInterval> | undefined;
  let onAbort: (() => void) | undefined;

  try {
    await Promise.race([
      esploader.writeFlash({
        fileArray: filesToFlash.map((file) => ({ address: file.address, data: file.data })),
        flashSize,
        flashMode,
        flashFreq,
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
            console.warn('[esp32Flasher] writeFlash stalled — disconnecting');
            void disconnectEsp32Transport(transport, serialPort).then(
              () => {
                reject(new Error('ESP32_FLASH_STALLED'));
              },
              () => {
                reject(new Error('ESP32_FLASH_STALLED'));
              },
            );
          }
        }, 2000);
      }),
      new Promise<never>((_, reject) => {
        if (!signal) return;
        onAbort = () => {
          void disconnectEsp32Transport(transport, serialPort).then(
            () => {
              reject(new Error('ESP32_FLASH_CANCELLED'));
            },
            () => {
              reject(new Error('ESP32_FLASH_CANCELLED'));
            },
          );
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (stallInterval) {
      clearInterval(stallInterval);
    }
    if (onAbort) {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  if (totalFirmwareBytes >= MIN_FLASH_BYTES_WRITTEN && maxBytesWritten < MIN_FLASH_BYTES_WRITTEN) {
    throw new Error('FLASH_TRANSFER_TOO_SMALL');
  }

  // Meshchat parity: DTR pulse reboot after writeFlash, then close port cleanly.
  await transport.setDTR(false);
  await sleepMillis(100);
  await transport.setDTR(true);
  await sleepMillis(1500);

  await disconnectEsp32Transport(transport, serialPort);
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

/** Stub `read_flash` ends with one 16-byte MD5 frame over the bytes it sent. */
const ESP32_READ_DIGEST_BYTES = 16;
const ESP32_READ_DIGEST_TIMEOUT_MS = 3000;

/**
 * Never guess: a wrong size saves a truncated image that looks like a full backup, and a
 * larger chip cannot be captured under the 32 MiB IPC cap.
 */
function resolveEsp32FlashSizeBytes(
  esploader: ESPLoader,
  flashId: number,
  fallbackFlashSize: string | undefined,
): number {
  const sizeId = (flashId >> 16) & 0xff;
  const detected = (esploader.DETECTED_FLASH_SIZES as Record<number, string | undefined>)[sizeId];
  const label = detected ?? fallbackFlashSize;
  if (!label) {
    throw new Error('ESP32_FLASH_SIZE_UNKNOWN');
  }
  const bytes = esploader.flashSizeBytes(label as FlashSizeValues);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw new Error('ESP32_FLASH_SIZE_UNKNOWN');
  }
  if (bytes > FIRMWARE_BACKUP_MAX_BYTES) {
    throw new Error('ESP32_FLASH_TOO_LARGE');
  }
  return bytes;
}

/**
 * esptool-js 0.6.1 `readFlash` returns once it has `size` bytes and leaves the stub's trailing
 * MD5 frame unread (esptool.py verifies it). Consume it here: it is the on-chip digest of the
 * streamed flash, and leaving it buffered would be misparsed as the next command's response.
 */
async function verifyEsp32ReadDigest(transport: Transport, data: Uint8Array): Promise<void> {
  let digest: Uint8Array;
  try {
    digest = await transport.read(ESP32_READ_DIGEST_TIMEOUT_MS);
  } catch (e) {
    console.warn(
      '[esp32Flasher] readFlash digest frame missing',
      e instanceof Error ? e.message : String(e),
    );
    throw new Error('ESP32_READ_VERIFY_FAILED');
  }
  if (digest.byteLength !== ESP32_READ_DIGEST_BYTES || bytesToHex(digest) !== md5HexBytes(data)) {
    console.warn('[esp32Flasher] readFlash digest mismatch');
    throw new Error('ESP32_READ_VERIFY_FAILED');
  }
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
    await verifyEsp32ReadDigest(transport, data);

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
