import type { FileEntry } from '@zip.js/zip.js';
import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';

import { closeSerialPortIfOpen } from '@/renderer/lib/connection';

import { blobToBinaryString } from './binaryUtils';
import { md5Latin1String } from './md5';
import type { Esp32FlashConfig, FlashProgressCallback } from './types';

const ESP32_FLASH_BAUD = 921600;
/** Reject instant "success" when almost no firmware bytes were written. */
const MIN_FLASH_BYTES_WRITTEN = 8192;

export async function flashEsp32Firmware(
  serialPort: SerialPort,
  firmwareZip: Blob,
  flashConfig: Esp32FlashConfig,
  progressCallback?: FlashProgressCallback,
): Promise<void> {
  await closeSerialPortIfOpen(serialPort);

  const { ESPLoader, Transport } = await import('esptool-js');

  const blobReader = new BlobReader(firmwareZip);
  const zipReader = new ZipReader(blobReader);
  const zipEntries = await zipReader.getEntries();

  const filesToFlash: { address: number; data: string }[] = [];
  for (const [address, filename] of Object.entries(flashConfig.flash_files)) {
    const entry = zipEntries.find(
      (zipEntry): zipEntry is FileEntry => !zipEntry.directory && zipEntry.filename === filename,
    );
    if (!entry) {
      throw new Error(`${filename} not found in firmware file`);
    }
    const blob = await entry.getData(new BlobWriter('application/octet-stream'));
    const data = await blobToBinaryString(blob);
    filesToFlash.push({ address: parseInt(address, 10), data });
  }

  const totalFirmwareBytes = filesToFlash.reduce((sum, file) => sum + file.data.length, 0);
  let maxBytesWritten = 0;

  const transport = new Transport(serialPort, true);
  const esploader = new ESPLoader({
    transport,
    baudrate: ESP32_FLASH_BAUD,
    romBaudrate: 115200,
    debugLogging: false,
    enableTracing: false,
    terminal: {
      clean() {
        // catch-no-log-ok: esptool-js terminal interface requires clean()
      },
      writeLine(data: string) {
        console.debug('[esptool]', data);
      },
      write(data: string) {
        console.debug('[esptool]', data);
      },
    },
  });

  await esploader.main();

  const chipName =
    (esploader as { chip?: { CHIP_NAME?: string } }).chip?.CHIP_NAME ??
    (esploader as { chipName?: string }).chipName ??
    '';
  if (!chipName) {
    throw new Error('ESP32_SYNC_FAILED');
  }

  await esploader.writeFlash({
    fileArray: filesToFlash,
    flashSize: flashConfig.flash_size,
    flashMode: 'dio',
    flashFreq: '80m',
    eraseAll: false,
    compress: true,
    calculateMD5Hash: (image: string) => md5Latin1String(image),
    reportProgress: (_fileIndex: number, written: number, total: number) => {
      maxBytesWritten = Math.max(maxBytesWritten, written);
      progressCallback?.(Math.floor((written / total) * 100));
    },
  });

  if (totalFirmwareBytes >= MIN_FLASH_BYTES_WRITTEN && maxBytesWritten < MIN_FLASH_BYTES_WRITTEN) {
    throw new Error('FLASH_TRANSFER_TOO_SMALL');
  }

  await transport.setDTR(false);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await transport.setDTR(true);

  await zipReader.close();
}
