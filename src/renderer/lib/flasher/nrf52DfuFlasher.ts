/**
 * nRF52 DFU serial transport — port of liamcottle/rnode-flasher nrf52_dfu_flasher.js
 * (adafruit-nrfutil dfu_transport_serial.py)
 */
import type { FileEntry } from '@zip.js/zip.js';
import { BlobReader, TextWriter, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

import { sleepMillis } from './binaryUtils';
import type { FlashProgressCallback } from './types';

export class Nrf52DfuFlasher {
  static readonly DFU_TOUCH_BAUD = 1200;
  static readonly SERIAL_PORT_OPEN_WAIT_TIME = 0.1;
  static readonly TOUCH_RESET_WAIT_TIME = 1.5;
  static readonly FLASH_BAUD = 115200;
  static readonly HEX_TYPE_APPLICATION = 4;
  static readonly DFU_INIT_PACKET = 1;
  static readonly DFU_START_PACKET = 3;
  static readonly DFU_DATA_PACKET = 4;
  static readonly DFU_STOP_DATA_PACKET = 5;
  static readonly DATA_INTEGRITY_CHECK_PRESENT = 1;
  static readonly RELIABLE_PACKET = 1;
  static readonly HCI_PACKET_TYPE = 14;
  static readonly FLASH_PAGE_SIZE = 4096;
  static readonly FLASH_PAGE_ERASE_TIME = 0.0897;
  static readonly FLASH_WORD_WRITE_TIME = 0.0001;
  static readonly DFU_PACKET_MAX_SIZE = 512;

  private sequenceNumber = 0;
  private sd_size = 0;
  private total_size = 0;

  constructor(private readonly serialPort: SerialPort) {}

  async sendPacket(data: number[] | Uint8Array): Promise<void> {
    const writer = this.serialPort.writable!.getWriter();
    try {
      await writer.write(new Uint8Array(data));
    } finally {
      writer.releaseLock();
    }
  }

  async enterDfuMode(): Promise<void> {
    await this.serialPort.open({ baudRate: Nrf52DfuFlasher.DFU_TOUCH_BAUD });
    await sleepMillis(Nrf52DfuFlasher.SERIAL_PORT_OPEN_WAIT_TIME * 1000);
    await this.serialPort.close();
    await sleepMillis(Nrf52DfuFlasher.TOUCH_RESET_WAIT_TIME * 1000);
  }

  async flash(firmwareZipBlob: Blob, progressCallback?: FlashProgressCallback): Promise<void> {
    const blobReader = new BlobReader(firmwareZipBlob);
    const zipReader = new ZipReader(blobReader);
    const zipEntries = await zipReader.getEntries();

    const manifestFile = zipEntries.find(
      (entry): entry is FileEntry => !entry.directory && entry.filename === 'manifest.json',
    );
    if (!manifestFile) {
      throw new Error('manifest.json not found in firmware file');
    }

    const text = await manifestFile.getData(new TextWriter());
    const json = JSON.parse(text) as {
      manifest: { application?: { bin_file: string; dat_file: string } };
    };
    const manifest = json.manifest;

    if (manifest.application) {
      await this.dfuSendImage(
        Nrf52DfuFlasher.HEX_TYPE_APPLICATION,
        zipEntries,
        manifest.application,
        progressCallback,
      );
    }

    await zipReader.close();
  }

  private async dfuSendImage(
    programMode: number,
    zipEntries: Awaited<ReturnType<ZipReader<BlobReader>['getEntries']>>,
    firmwareManifest: { bin_file: string; dat_file: string },
    progressCallback?: FlashProgressCallback,
  ): Promise<void> {
    await this.serialPort.open({ baudRate: Nrf52DfuFlasher.FLASH_BAUD });
    await sleepMillis(Nrf52DfuFlasher.SERIAL_PORT_OPEN_WAIT_TIME * 1000);

    const softdeviceSize = 0;
    const bootloaderSize = 0;

    const binFile = zipEntries.find(
      (entry): entry is FileEntry =>
        !entry.directory && entry.filename === firmwareManifest.bin_file,
    );
    if (!binFile) {
      throw new Error(`${firmwareManifest.bin_file} not found in firmware zip`);
    }
    const firmware = await binFile.getData(new Uint8ArrayWriter());

    const datFile = zipEntries.find(
      (entry): entry is FileEntry =>
        !entry.directory && entry.filename === firmwareManifest.dat_file,
    );
    if (!datFile) {
      throw new Error(`${firmwareManifest.dat_file} not found in firmware zip`);
    }
    const initPacket = await datFile.getData(new Uint8ArrayWriter());

    if (programMode !== Nrf52DfuFlasher.HEX_TYPE_APPLICATION) {
      throw new Error('Only application flashing is supported');
    }

    const applicationSize = firmware.length;

    await this.sendStartDfu(programMode, softdeviceSize, bootloaderSize, applicationSize);
    await this.sendInitPacket(initPacket);
    await this.sendFirmware(firmware, progressCallback);
  }

  /** Exposed for unit tests. */
  calcCrc16(binaryData: Uint8Array, crc = 0xffff): number {
    for (const b of binaryData) {
      crc = ((crc >> 8) & 0x00ff) | ((crc << 8) & 0xff00);
      crc ^= b;
      crc ^= (crc & 0x00ff) >> 4;
      crc ^= (crc << 8) << 4;
      crc ^= ((crc & 0x00ff) << 4) << 1;
    }
    return crc & 0xffff;
  }

  /** Exposed for unit tests. */
  slipEncodeEscChars(dataIn: number[]): number[] {
    const result: number[] = [];
    for (const char of dataIn) {
      if (char === 0xc0) {
        result.push(0xdb, 0xdc);
      } else if (char === 0xdb) {
        result.push(0xdb, 0xdd);
      } else {
        result.push(char);
      }
    }
    return result;
  }

  createHciPacketFromFrame(frame: number[]): number[] {
    this.sequenceNumber = (this.sequenceNumber + 1) % 8;

    const slipHeaderBytes = this.createSlipHeader(
      this.sequenceNumber,
      Nrf52DfuFlasher.DATA_INTEGRITY_CHECK_PRESENT,
      Nrf52DfuFlasher.RELIABLE_PACKET,
      Nrf52DfuFlasher.HCI_PACKET_TYPE,
      frame.length,
    );

    const data = [...slipHeaderBytes, ...frame];
    const crc = this.calcCrc16(new Uint8Array(data), 0xffff);
    data.push(crc & 0xff, (crc & 0xff00) >> 8);

    return [0xc0, ...this.slipEncodeEscChars(data), 0xc0];
  }

  private getEraseWaitTime(): number {
    return Math.max(
      0.5,
      (this.total_size / Nrf52DfuFlasher.FLASH_PAGE_SIZE + 1) *
        Nrf52DfuFlasher.FLASH_PAGE_ERASE_TIME,
    );
  }

  private createImageSizePacket(softdeviceSize = 0, bootloaderSize = 0, appSize = 0): number[] {
    return [
      ...this.int32ToBytes(softdeviceSize),
      ...this.int32ToBytes(bootloaderSize),
      ...this.int32ToBytes(appSize),
    ];
  }

  private async sendStartDfu(
    mode: number,
    softdevice_size = 0,
    bootloader_size = 0,
    app_size = 0,
  ): Promise<void> {
    const frame = [
      ...this.int32ToBytes(Nrf52DfuFlasher.DFU_START_PACKET),
      ...this.int32ToBytes(mode),
      ...this.createImageSizePacket(softdevice_size, bootloader_size, app_size),
    ];

    await this.sendPacket(this.createHciPacketFromFrame(frame));

    this.sd_size = softdevice_size;
    this.total_size = softdevice_size + bootloader_size + app_size;

    await sleepMillis(this.getEraseWaitTime() * 1000);
  }

  private async sendInitPacket(initPacket: Uint8Array): Promise<void> {
    const frame = [
      ...this.int32ToBytes(Nrf52DfuFlasher.DFU_INIT_PACKET),
      ...initPacket,
      ...this.int16ToBytes(0x0000),
    ];
    await this.sendPacket(this.createHciPacketFromFrame(frame));
  }

  private async sendFirmware(
    firmware: Uint8Array,
    progressCallback?: FlashProgressCallback,
  ): Promise<void> {
    const packets: number[][] = [];
    for (let i = 0; i < firmware.length; i += Nrf52DfuFlasher.DFU_PACKET_MAX_SIZE) {
      packets.push(
        this.createHciPacketFromFrame([
          ...this.int32ToBytes(Nrf52DfuFlasher.DFU_DATA_PACKET),
          ...firmware.slice(i, i + Nrf52DfuFlasher.DFU_PACKET_MAX_SIZE),
        ]),
      );
    }

    progressCallback?.(0);

    const flashPageWriteTime =
      (Nrf52DfuFlasher.FLASH_PAGE_SIZE / 4) * Nrf52DfuFlasher.FLASH_WORD_WRITE_TIME;

    for (let i = 0; i < packets.length; i++) {
      await this.sendPacket(packets[i]);
      await sleepMillis(flashPageWriteTime * 1000);
      progressCallback?.(Math.floor(((i + 1) / packets.length) * 100));
    }

    await this.sendPacket(
      this.createHciPacketFromFrame([...this.int32ToBytes(Nrf52DfuFlasher.DFU_STOP_DATA_PACKET)]),
    );
  }

  private createSlipHeader(
    seq: number,
    dip: number,
    rp: number,
    pktType: number,
    pktLen: number,
  ): Uint8Array {
    const ints = [0, 0, 0, 0];
    ints[0] = seq | (((seq + 1) % 8) << 3) | (dip << 6) | (rp << 7);
    ints[1] = pktType | ((pktLen & 0x000f) << 4);
    ints[2] = (pktLen & 0x0ff0) >> 4;
    ints[3] = (~(ints[0] + ints[1] + ints[2]) + 1) & 0xff;
    return new Uint8Array(ints);
  }

  private int32ToBytes(num: number): number[] {
    return [
      num & 0x000000ff,
      (num & 0x0000ff00) >> 8,
      (num & 0x00ff0000) >> 16,
      (num & 0xff000000) >> 24,
    ];
  }

  private int16ToBytes(num: number): number[] {
    return [num & 0x00ff, (num & 0xff00) >> 8];
  }
}
