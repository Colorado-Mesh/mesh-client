import { beforeEach, describe, expect, it, vi } from 'vitest';

import { touch } from '@/shared/touch';

const { readFlashMock, readFlashIdMock, transportReadMock } = vi.hoisted(() => ({
  readFlashMock: vi.fn(),
  readFlashIdMock: vi.fn(() => Promise.resolve(0x164020)),
  transportReadMock: vi.fn<(timeout: number) => Promise<Uint8Array>>(),
}));

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
      read: transportReadMock,
    };
  }),
  ESPLoader: vi.fn(function ESPLoader() {
    return {
      chip: { CHIP_NAME: 'ESP32' },
      main: () => Promise.resolve(),
      writeFlash: writeFlashMock,
      readFlash: readFlashMock,
      readFlashId: readFlashIdMock,
      DETECTED_FLASH_SIZES: { 0x14: '1MB', 0x16: '4MB', 0x18: '16MB' },
      flashSizeBytes: (size: string) => {
        const mb = Number.parseInt(size, 10);
        return Number.isFinite(mb) ? mb * 1024 * 1024 : -1;
      },
    };
  }),
}));

import { closeSerialPortIfOpen } from '@/renderer/lib/connection';
import { hexToBytesLenient } from '@/shared/hexBytes';

import { flashEsp32Firmware, readEsp32Flash } from './esp32Flasher';
import { md5HexBytes } from './md5';

/** readFlash returns `data`; the stub then sends the MD5 digest frame of what it streamed. */
function mockStubRead(makeData: (size: number) => Uint8Array): void {
  let last: Uint8Array = new Uint8Array();
  readFlashMock.mockImplementation((_addr: number, size: number) => {
    last = makeData(size);
    return Promise.resolve(last);
  });
  transportReadMock.mockImplementation(() => Promise.resolve(hexToBytesLenient(md5HexBytes(last))));
}

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

describe('readEsp32Flash', () => {
  const MB = 1024 * 1024;
  beforeEach(() => {
    readFlashMock.mockReset();
    readFlashIdMock.mockReset();
    readFlashIdMock.mockResolvedValue(0x164020);
    transportReadMock.mockReset();
    vi.mocked(closeSerialPortIfOpen).mockClear();
  });

  it('reads the JEDEC-detected flash size from address 0 and reports progress', async () => {
    const progress: number[] = [];
    mockStubRead((size) => new Uint8Array(size));
    const verified = readFlashMock.getMockImplementation();
    readFlashMock.mockImplementation(
      (addr: number, size: number, cb: (p: Uint8Array, n: number, t: number) => void) => {
        expect(addr).toBe(0);
        cb(new Uint8Array(), size / 2, size);
        cb(new Uint8Array(), size, size);
        return verified?.(addr, size, cb) as Promise<Uint8Array>;
      },
    );
    const result = await readEsp32Flash({} as SerialPort, {
      fallbackFlashSize: '16MB',
      progressCallback: (p) => progress.push(p),
    });
    expect(readFlashMock).toHaveBeenCalledWith(0, 4 * MB, expect.any(Function));
    expect(result).toMatchObject({ chipName: 'ESP32', flashSizeBytes: 4 * MB });
    expect(result.data.byteLength).toBe(4 * MB);
    expect(progress).toEqual(expect.arrayContaining([50, 100]));
    expect(transportReadMock).toHaveBeenCalledOnce();
    expect(closeSerialPortIfOpen).toHaveBeenCalled();
  });

  it('falls back to the catalog flash size when the JEDEC size byte is unknown', async () => {
    readFlashIdMock.mockResolvedValue(0x7f4020);
    mockStubRead((size) => new Uint8Array(size));
    const result = await readEsp32Flash({} as SerialPort, { fallbackFlashSize: '1MB' });
    expect(result.flashSizeBytes).toBe(MB);
  });

  it('refuses to guess when neither JEDEC nor the catalog knows the flash size', async () => {
    readFlashIdMock.mockResolvedValue(0x7f4020);
    await expect(readEsp32Flash({} as SerialPort)).rejects.toThrow('ESP32_FLASH_SIZE_UNKNOWN');
    expect(readFlashMock).not.toHaveBeenCalled();
    expect(closeSerialPortIfOpen).toHaveBeenCalled();
  });

  it('refuses flash larger than the backup cap instead of saving a truncated image', async () => {
    readFlashIdMock.mockResolvedValue(0x7f4020);
    await expect(readEsp32Flash({} as SerialPort, { fallbackFlashSize: '64MB' })).rejects.toThrow(
      'ESP32_FLASH_TOO_LARGE',
    );
    expect(readFlashMock).not.toHaveBeenCalled();
  });

  it('rejects a short read instead of returning a truncated image', async () => {
    readFlashMock.mockResolvedValue(new Uint8Array(16));
    await expect(readEsp32Flash({} as SerialPort)).rejects.toThrow('ESP32_READ_INCOMPLETE');
    expect(closeSerialPortIfOpen).toHaveBeenCalled();
  });

  it('verifies the image against the stub digest frame after readFlash', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    readFlashIdMock.mockResolvedValue(0x144020);
    readFlashMock.mockImplementation((_a: number, size: number) =>
      Promise.resolve(new Uint8Array(size).fill(0xaa)),
    );
    transportReadMock.mockResolvedValue(hexToBytesLenient(md5HexBytes(new Uint8Array(MB))));
    await expect(readEsp32Flash({} as SerialPort)).rejects.toThrow('ESP32_READ_VERIFY_FAILED');
    expect(transportReadMock).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('fails verification when the digest frame never arrives', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    readFlashIdMock.mockResolvedValue(0x144020);
    readFlashMock.mockImplementation((_a: number, size: number) =>
      Promise.resolve(new Uint8Array(size)),
    );
    transportReadMock.mockRejectedValue(new Error('No serial data received.'));
    await expect(readEsp32Flash({} as SerialPort)).rejects.toThrow('ESP32_READ_VERIFY_FAILED');
    warn.mockRestore();
  });

  it('aborts an in-flight read, closes the port, and reports cancellation', async () => {
    const controller = new AbortController();
    readFlashMock.mockImplementation(() => {
      queueMicrotask(() => {
        controller.abort();
      });
      return new Promise(() => {});
    });
    await expect(readEsp32Flash({} as SerialPort, { signal: controller.signal })).rejects.toThrow(
      'ESP32_READ_CANCELLED',
    );
    expect(closeSerialPortIfOpen).toHaveBeenCalled();
  });

  it('does not touch the port when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readEsp32Flash({} as SerialPort, { signal: controller.signal })).rejects.toThrow(
      'ESP32_READ_CANCELLED',
    );
    expect(readFlashMock).not.toHaveBeenCalled();
  });
});
