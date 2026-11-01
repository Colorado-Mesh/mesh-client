/** Shared fixtures for device-firmware flasher tests (not shipped in production code paths). */
import type { FirmwareFileEntry } from './deviceFirmwareImage';
import { nrf52DfuCrc16 } from './nrf52DfuFlasher';

export const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export interface EspImageOptions {
  chipId: number;
  size?: number;
  /** 0 = header at 0 (ESP32-S3 style); 0x1000 = classic ESP32 padded layout. */
  headerOffset?: 0 | 0x1000;
  /** ESP image header flash-size code (high nibble of byte 3): 2=4MB, 3=8MB, 4=16MB. */
  flashSizeCode?: number;
}

export function makeEspImage({
  chipId,
  size = 0x30000,
  headerOffset = 0,
  flashSizeCode = 3,
}: EspImageOptions): Uint8Array {
  const data = new Uint8Array(size).fill(0xff);
  data[headerOffset] = 0xe9;
  data[headerOffset + 3] = flashSizeCode << 4;
  data[headerOffset + 12] = chipId & 0xff;
  data[headerOffset + 13] = (chipId >> 8) & 0xff;
  return data;
}

/** Bytes that look like a zip to `isZipBytes` (content is served by a fake `readEntries`). */
export function fakeZipBytes(tag = 0): Uint8Array {
  return new Uint8Array([...ZIP_MAGIC, tag, 1, 2, 3]);
}

export function fileEntry(name: string, data: Uint8Array): FirmwareFileEntry {
  return { name, read: () => Promise.resolve(data) };
}

export function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export interface DfuFixture {
  entries: FirmwareFileEntry[];
  bin: Uint8Array;
  dat: Uint8Array;
}

/** Legacy serial-DFU package entries with a valid init packet (CRC16 over `bin`). */
export function makeDfuEntries(
  overrides: { manifest?: unknown; crcDelta?: number; sdCount?: number } = {},
): DfuFixture {
  const bin = new Uint8Array(256).map((_, i) => (i * 7) & 0xff);
  const sdCount = overrides.sdCount ?? 0;
  const dat = new Uint8Array(10 + sdCount * 2 + 2);
  dat[8] = sdCount & 0xff;
  const crc = (nrf52DfuCrc16(bin) + (overrides.crcDelta ?? 0)) & 0xffff;
  dat[dat.length - 2] = crc & 0xff;
  dat[dat.length - 1] = (crc >> 8) & 0xff;
  const manifest = overrides.manifest ?? {
    manifest: { application: { bin_file: 'app.bin', dat_file: 'app.dat' } },
  };
  return {
    bin,
    dat,
    entries: [
      fileEntry('manifest.json', textBytes(JSON.stringify(manifest))),
      fileEntry('app.bin', bin),
      fileEntry('app.dat', dat),
    ],
  };
}
