import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Nrf52Module from './nrf52DfuFlasher';

const { flashEsp32ImagesMock, nrfFlashMock } = vi.hoisted(() => ({
  flashEsp32ImagesMock: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
  nrfFlashMock: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock('@/renderer/lib/connection', () => ({
  closeSerialPortIfOpen: vi.fn(() => Promise.resolve()),
}));
vi.mock('./esp32Flasher', () => ({ flashEsp32Images: flashEsp32ImagesMock }));
vi.mock('./nrf52DfuFlasher', async (importOriginal) => {
  const actual = await importOriginal<typeof Nrf52Module>();
  return {
    ...actual,
    Nrf52DfuFlasher: vi.fn(function Nrf52DfuFlasher() {
      return { flash: nrfFlashMock };
    }),
  };
});

import { getDeviceFlashBoardById } from './deviceFirmwareBoards';
import {
  assertPlanMatchesBoard,
  expectedEspChipName,
  runDeviceFirmwareFlash,
} from './deviceFirmwareFlash';
import {
  DeviceFirmwareError,
  type DeviceFirmwarePlan,
  type Esp32DeviceFirmwarePlan,
} from './deviceFirmwareImage';
import { makeEspImage } from './deviceFirmwareTestFixtures';

function board(id: string) {
  const found = getDeviceFlashBoardById(id);
  if (!found) throw new Error(id);
  return found;
}

function espPlan(
  boardId: string,
  chipId: number,
  headerOffset: 0 | 0x1000 = 0,
): Esp32DeviceFirmwarePlan {
  const data = makeEspImage({ chipId, headerOffset });
  return {
    kind: 'esp32',
    board: board(boardId),
    releaseLabel: '1',
    sourceName: 'x.bin',
    fileSha256: 'a',
    payloadSha256: 'a',
    payloadBytes: data.byteLength,
    images: [{ name: 'x.bin', address: 0, data }],
  };
}

describe('runDeviceFirmwareFlash', () => {
  beforeEach(() => {
    flashEsp32ImagesMock.mockClear();
    nrfFlashMock.mockClear();
  });

  it('maps board families to esptool chip names', () => {
    expect(expectedEspChipName('esp32')).toBe('ESP32');
    expect(expectedEspChipName('esp32s3')).toBe('ESP32-S3');
    expect(expectedEspChipName('nrf52840')).toBeNull();
  });

  it('flashes ESP32 at address 0 with the header kept and the chip pinned', async () => {
    const signal = new AbortController().signal;
    const progress = vi.fn();
    await runDeviceFirmwareFlash({} as SerialPort, espPlan('meshtastic:heltec-v3', 0x0009), {
      signal,
      progressCallback: progress,
    });
    expect(flashEsp32ImagesMock).toHaveBeenCalledOnce();
    const [, images, options] = flashEsp32ImagesMock.mock.calls[0] as unknown as [
      SerialPort,
      { address: number }[],
      Record<string, unknown>,
    ];
    expect(images).toHaveLength(1);
    expect(images[0]?.address).toBe(0);
    expect(options).toMatchObject({
      flashSize: 'keep',
      flashMode: 'keep',
      flashFreq: 'keep',
      expectedChipName: 'ESP32-S3',
      skipRNodePrepare: true,
      signal,
      progressCallback: progress,
    });
  });

  it('pins classic ESP32 for T-Beam', async () => {
    await runDeviceFirmwareFlash({} as SerialPort, espPlan('meshtastic:tbeam', 0, 0x1000));
    expect(flashEsp32ImagesMock.mock.calls[0]?.[2]).toMatchObject({ expectedChipName: 'ESP32' });
  });

  it('refuses to touch the port when the image chip does not match the board', async () => {
    await expect(
      runDeviceFirmwareFlash({} as SerialPort, espPlan('meshtastic:heltec-v3', 0x0000, 0x1000)),
    ).rejects.toThrow('IMAGE_CHIP_MISMATCH');
    expect(flashEsp32ImagesMock).not.toHaveBeenCalled();
  });

  it('refuses a plan whose family does not match its board', () => {
    const rakBoard = board('meshtastic:rak4631');
    expect(() => {
      assertPlanMatchesBoard(espPlan('meshtastic:heltec-v3', 9), rakBoard);
    }).toThrow(DeviceFirmwareError);
    const dfuPlan: DeviceFirmwarePlan = {
      kind: 'nrf52',
      board: rakBoard,
      releaseLabel: '1',
      sourceName: 'x.zip',
      fileSha256: 'a',
      payloadSha256: 'a',
      payloadBytes: 4,
      dfuPackage: new Uint8Array(4),
    };
    expect(() => {
      assertPlanMatchesBoard(dfuPlan, board('meshtastic:heltec-v3'));
    }).toThrow(DeviceFirmwareError);
  });

  it('runs the nRF52 DFU flasher with the package and abort signal', async () => {
    const rakBoard = board('meshtastic:rak4631');
    const signal = new AbortController().signal;
    await runDeviceFirmwareFlash(
      {} as SerialPort,
      {
        kind: 'nrf52',
        board: rakBoard,
        releaseLabel: '1',
        sourceName: 'x.zip',
        fileSha256: 'a',
        payloadSha256: 'a',
        payloadBytes: 4,
        dfuPackage: new Uint8Array([1, 2, 3, 4]),
      },
      { signal },
    );
    expect(nrfFlashMock).toHaveBeenCalledOnce();
    const args = nrfFlashMock.mock.calls[0] as unknown as [Blob, unknown, { signal: AbortSignal }];
    expect(args[0]).toBeInstanceOf(Blob);
    expect(args[2].signal).toBe(signal);
    expect(flashEsp32ImagesMock).not.toHaveBeenCalled();
  });
});
