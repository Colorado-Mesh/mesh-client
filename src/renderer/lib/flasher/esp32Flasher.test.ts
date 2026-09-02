import { beforeEach, describe, expect, it, vi } from 'vitest';

import { touch } from '@/shared/touch';

const { writeFlashMock } = vi.hoisted(() => ({
  writeFlashMock: vi.fn(
    (opts: {
      fileArray: { address: number; data: Uint8Array }[];
      calculateMD5Hash?: (image: Uint8Array) => string;
      reportProgress?: (fileIndex: number, written: number, total: number) => void;
    }) => {
      capturedWriteFlashOpts = opts;
      opts.reportProgress?.(0, 4, 4);
      return Promise.resolve();
    },
  ),
}));

let capturedWriteFlashOpts: {
  fileArray: { address: number; data: Uint8Array }[];
  calculateMD5Hash?: (image: Uint8Array) => string;
  reportProgress?: (fileIndex: number, written: number, total: number) => void;
} | null = null;

vi.mock('@/renderer/lib/connection', () => ({
  closeSerialPortIfOpen: vi.fn(() => Promise.resolve()),
}));

vi.mock('./esp32BootloaderEntry', () => ({
  forceEsp32DownloadMode: vi.fn(() => Promise.resolve()),
}));

vi.mock('./prepareEsp32PortForFlash', () => ({
  prepareEsp32PortForFlash: vi.fn(() => Promise.resolve()),
}));

vi.mock('@zip.js/zip.js', () => ({
  BlobReader: vi.fn(function BlobReader(_blob: unknown) {
    touch(_blob);
  }),
  BlobWriter: vi.fn(function BlobWriter(this: { mimeType: string }, mimeType: string) {
    this.mimeType = mimeType;
  }),
  ZipReader: vi.fn(function ZipReader() {
    return {
      getEntries: () =>
        Promise.resolve([
          {
            directory: false,
            filename: 'firmware.bin',
            getData: () => Promise.resolve(new Blob([new Uint8Array([0x00, 0x80, 0xff, 0x01])])),
          },
        ]),
      close: () => Promise.resolve(),
    };
  }),
}));

vi.mock('esptool-js', () => ({
  Transport: vi.fn(function Transport() {
    return {
      setDTR: () => Promise.resolve(),
      disconnect: () => Promise.resolve(),
    };
  }),
  ESPLoader: vi.fn(function ESPLoader() {
    return {
      chip: { CHIP_NAME: 'ESP32' },
      main: () => Promise.resolve(),
      writeFlash: writeFlashMock,
    };
  }),
}));

import { flashEsp32Firmware } from './esp32Flasher';

describe('esp32Flasher stall timeout contract', () => {
  it('uses a 60s stall watchdog constant', async () => {
    const source = await import('./esp32Flasher?raw');
    expect(source.default).toContain('ESP32_FLASH_STALLED');
    expect(source.default).toContain('60_000');
    expect(source.default).toContain('hasSeenProgress');
  });
});

describe('flashEsp32Firmware Uint8Array flash path', () => {
  beforeEach(() => {
    writeFlashMock.mockClear();
    capturedWriteFlashOpts = null;
  });

  it('passes Uint8Array file data to writeFlash and MD5 callback', async () => {
    const serialPort = {} as SerialPort;
    await flashEsp32Firmware(serialPort, new Blob(['zip']), {
      flash_size: '4MB',
      flash_files: { '0x10000': 'firmware.bin' },
    });

    expect(writeFlashMock).toHaveBeenCalledOnce();
    expect(capturedWriteFlashOpts).not.toBeNull();
    const fileArray = capturedWriteFlashOpts?.fileArray ?? [];
    expect(fileArray).toHaveLength(1);
    expect(fileArray[0]?.address).toBe(0x10000);
    expect(fileArray[0]?.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(fileArray[0]?.data ?? [])).toEqual([0x00, 0x80, 0xff, 0x01]);

    const md5Input = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const md5 = capturedWriteFlashOpts?.calculateMD5Hash?.(md5Input);
    expect(typeof md5).toBe('string');
    expect(md5).toHaveLength(32);
  });

  it('accounts total firmware size with byteLength', async () => {
    const serialPort = {} as SerialPort;
    await flashEsp32Firmware(serialPort, new Blob(['zip']), {
      flash_size: '4MB',
      flash_files: { '0x10000': 'firmware.bin' },
    });

    const totalBytes = (capturedWriteFlashOpts?.fileArray ?? []).reduce(
      (sum, file) => sum + file.data.byteLength,
      0,
    );
    expect(totalBytes).toBe(4);
  });
});
