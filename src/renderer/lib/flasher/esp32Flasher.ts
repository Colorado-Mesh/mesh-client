import type { FileEntry } from '@zip.js/zip.js';
import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';

import { blobToBinaryString } from './binaryUtils';
import { md5Latin1String } from './md5';
import type { Esp32FlashConfig, FlashProgressCallback } from './types';

const ESP32_FLASH_BAUD = 921600;

export async function flashEsp32Firmware(
  serialPort: SerialPort,
  firmwareZip: Blob,
  flashConfig: Esp32FlashConfig,
  progressCallback?: FlashProgressCallback,
): Promise<void> {
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

  await esploader.writeFlash({
    fileArray: filesToFlash,
    flashSize: flashConfig.flash_size,
    flashMode: 'dio',
    flashFreq: '80m',
    eraseAll: false,
    compress: true,
    calculateMD5Hash: (image: string) => md5Latin1String(image),
    reportProgress: (_fileIndex: number, written: number, total: number) => {
      progressCallback?.(Math.floor((written / total) * 100));
    },
  });

  await transport.setDTR(false);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await transport.setDTR(true);

  await zipReader.close();
}
