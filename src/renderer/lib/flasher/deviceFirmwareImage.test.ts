import { describe, expect, it } from 'vitest';

import { getDeviceFlashBoardById } from './deviceFirmwareBoards';
import {
  DeviceFirmwareError,
  type DeviceFirmwareErrorCode,
  type FirmwareFileEntry,
  parseEspImageHeader,
  parseExpectedSha256,
  planDeviceFirmware,
  readZipEntries,
  sha256Hex,
  validateNrf52DfuPackage,
} from './deviceFirmwareImage';
import {
  fakeZipBytes,
  fileEntry,
  makeDfuEntries,
  makeEspImage,
  textBytes,
} from './deviceFirmwareTestFixtures';

function board(id: string) {
  const found = getDeviceFlashBoardById(id);
  if (!found) throw new Error(`missing board ${id}`);
  return found;
}

async function codeOf(promise: Promise<unknown>): Promise<DeviceFirmwareErrorCode | 'resolved'> {
  try {
    await promise;
    return 'resolved';
  } catch (e) {
    if (e instanceof DeviceFirmwareError) return e.code;
    throw e;
  }
}

const S3 = 0x0009;
const CLASSIC = 0x0000;

describe('parseEspImageHeader', () => {
  it('reads the chip id and flash size at offset 0', () => {
    expect(parseEspImageHeader(makeEspImage({ chipId: S3, flashSizeCode: 3 }))).toEqual({
      chipId: S3,
      flashBytes: 8 * 1024 * 1024,
    });
  });

  it('finds the classic ESP32 bootloader at 0x1000 behind 0xFF padding', () => {
    expect(
      parseEspImageHeader(
        makeEspImage({ chipId: CLASSIC, headerOffset: 0x1000, flashSizeCode: 2 }),
      ),
    ).toEqual({ chipId: CLASSIC, flashBytes: 4 * 1024 * 1024 });
  });

  it('returns null without the 0xE9 magic', () => {
    expect(parseEspImageHeader(new Uint8Array(0x20000).fill(0xff))).toBeNull();
  });
});

describe('planDeviceFirmware — Meshtastic ESP32', () => {
  const heltec = board('meshtastic:heltec-v3');
  const tbeam = board('meshtastic:tbeam');
  const s3Image = makeEspImage({ chipId: S3 });

  it('accepts a bare factory.bin for the selected board', async () => {
    const plan = await planDeviceFirmware(
      { name: 'firmware-heltec-v3-2.7.15.567b8ea.factory.bin', bytes: s3Image },
      heltec,
    );
    expect(plan.kind).toBe('esp32');
    if (plan.kind !== 'esp32') return;
    expect(plan.images).toHaveLength(1);
    expect(plan.images[0]).toMatchObject({
      address: 0,
      name: expect.stringContaining('.factory.bin'),
    });
    expect(plan.releaseLabel).toBe('2.7.15.567b8ea');
    expect(plan.fileSha256).toBe(sha256Hex(s3Image));
    expect(plan.payloadSha256).toBe(plan.fileSha256);
  });

  it('picks only the selected board from a multi-board release zip', async () => {
    const entries: FirmwareFileEntry[] = [
      fileEntry('firmware-heltec-v3-2.7.15.567b8ea.factory.bin', s3Image),
      fileEntry('firmware-heltec-v3-2.7.15.567b8ea-update.bin', makeEspImage({ chipId: S3 })),
      fileEntry('firmware-heltec-v4-2.7.15.567b8ea.factory.bin', makeEspImage({ chipId: S3 })),
      fileEntry('littlefs-heltec-v3-2.7.15.567b8ea.bin', new Uint8Array(10)),
      fileEntry('bleota-s3.bin', new Uint8Array(10)),
    ];
    const plan = await planDeviceFirmware(
      { name: 'firmware-esp32s3-2.7.15.567b8ea.zip', bytes: fakeZipBytes() },
      heltec,
      { readEntries: () => Promise.resolve(entries) },
    );
    expect(plan.kind === 'esp32' && plan.images[0]?.name).toBe(
      'firmware-heltec-v3-2.7.15.567b8ea.factory.bin',
    );
  });

  it('refuses a zip without an image for the board (fail closed, no fuzzy matching)', async () => {
    const entries = [fileEntry('firmware-heltec-v4-2.7.15.abcdef0.factory.bin', s3Image)];
    expect(
      await codeOf(
        planDeviceFirmware({ name: 'fw.zip', bytes: fakeZipBytes() }, heltec, {
          readEntries: () => Promise.resolve(entries),
        }),
      ),
    ).toBe('IMAGE_NOT_FOUND_FOR_BOARD');
  });

  it('refuses a bare file named for a different supported board and names it', async () => {
    const err = await planDeviceFirmware(
      { name: 'firmware-tbeam-2.7.15.567b8ea.factory.bin', bytes: s3Image },
      heltec,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeviceFirmwareError);
    expect(err).toMatchObject({ code: 'IMAGE_BOARD_MISMATCH', detail: 'LilyGo T-Beam' });
  });

  it('does not confuse tbeam with a longer slug like tbeam-s3-core', async () => {
    expect(
      await codeOf(
        planDeviceFirmware(
          { name: 'firmware-tbeam-s3-core-2.7.15.567b8ea.factory.bin', bytes: s3Image },
          tbeam,
        ),
      ),
    ).toBe('IMAGE_NAME_UNRECOGNIZED');
  });

  it('refuses update-only images (not the full-flash image)', async () => {
    expect(
      await codeOf(
        planDeviceFirmware(
          { name: 'firmware-heltec-v3-2.7.15.567b8ea-update.bin', bytes: s3Image },
          heltec,
        ),
      ),
    ).toBe('IMAGE_NOT_FULL_IMAGE');
  });

  it('refuses a correctly named image built for the wrong chip', async () => {
    const classicImage = makeEspImage({ chipId: CLASSIC, headerOffset: 0x1000 });
    expect(
      await codeOf(
        planDeviceFirmware(
          { name: 'firmware-heltec-v3-2.7.15.567b8ea.factory.bin', bytes: classicImage },
          heltec,
        ),
      ),
    ).toBe('IMAGE_CHIP_MISMATCH');
  });

  it('refuses an S3 image renamed to a classic ESP32 board', async () => {
    expect(
      await codeOf(
        planDeviceFirmware(
          { name: 'firmware-tbeam-2.7.15.567b8ea.factory.bin', bytes: s3Image },
          tbeam,
        ),
      ),
    ).toBe('IMAGE_CHIP_MISMATCH');
  });

  it('accepts the classic ESP32 layout for T-Beam', async () => {
    const image = makeEspImage({ chipId: CLASSIC, headerOffset: 0x1000, flashSizeCode: 2 });
    const plan = await planDeviceFirmware(
      { name: 'firmware-tbeam-2.7.15.567b8ea.factory.bin', bytes: image },
      tbeam,
    );
    expect(plan.kind).toBe('esp32');
  });

  it('refuses images with a header flash size larger than the board', async () => {
    expect(
      await codeOf(
        planDeviceFirmware(
          {
            name: 'firmware-tbeam-2.7.15.567b8ea.factory.bin',
            bytes: makeEspImage({ chipId: CLASSIC, headerOffset: 0x1000, flashSizeCode: 4 }),
          },
          tbeam,
        ),
      ),
    ).toBe('IMAGE_TOO_LARGE');
  });

  it('refuses images larger than the board flash', async () => {
    expect(
      await codeOf(
        planDeviceFirmware(
          {
            name: 'firmware-tbeam-2.7.15.567b8ea.factory.bin',
            bytes: makeEspImage({
              chipId: CLASSIC,
              headerOffset: 0x1000,
              flashSizeCode: 2,
              size: 4 * 1024 * 1024 + 1,
            }),
          },
          tbeam,
        ),
      ),
    ).toBe('IMAGE_TOO_LARGE');
  });

  it('refuses files without an ESP image header, tiny files, and empty files', async () => {
    const name = 'firmware-heltec-v3-2.7.15.567b8ea.factory.bin';
    expect(
      await codeOf(planDeviceFirmware({ name, bytes: new Uint8Array(0x30000).fill(0x11) }, heltec)),
    ).toBe('IMAGE_HEADER_INVALID');
    expect(
      await codeOf(
        planDeviceFirmware({ name, bytes: makeEspImage({ chipId: S3, size: 1024 }) }, heltec),
      ),
    ).toBe('IMAGE_TOO_SMALL');
    expect(await codeOf(planDeviceFirmware({ name, bytes: new Uint8Array(0) }, heltec))).toBe(
      'IMAGE_EMPTY',
    );
  });

  it('refuses ambiguous zips that contain two matching images', async () => {
    const entries = [
      fileEntry('a/firmware-heltec-v3-2.7.15.567b8ea.factory.bin', s3Image),
      fileEntry('b/firmware-heltec-v3-2.7.14.aaaaaaa.factory.bin', s3Image),
    ];
    expect(
      await codeOf(
        planDeviceFirmware({ name: 'fw.zip', bytes: fakeZipBytes() }, heltec, {
          readEntries: () => Promise.resolve(entries),
        }),
      ),
    ).toBe('IMAGE_AMBIGUOUS');
  });
});

describe('planDeviceFirmware — MeshCore', () => {
  const heltec = board('meshcore:heltec-v3');
  const s3Image = makeEspImage({ chipId: S3 });

  it('accepts the companion merged image for the board', async () => {
    const plan = await planDeviceFirmware(
      { name: 'Heltec_v3_companion_radio_ble-v1.9.1-abc1234-merged.bin', bytes: s3Image },
      heltec,
    );
    expect(plan.kind).toBe('esp32');
    expect(plan.releaseLabel).toBe('1.9.1-abc1234');
  });

  it('refuses repeater images for the same board', async () => {
    expect(
      await codeOf(
        planDeviceFirmware(
          { name: 'Heltec_v3_repeater-v1.9.1-abc1234-merged.bin', bytes: s3Image },
          heltec,
        ),
      ),
    ).toBe('IMAGE_NOT_COMPANION');
  });

  it('refuses the non-merged app-only image', async () => {
    expect(
      await codeOf(
        planDeviceFirmware(
          { name: 'Heltec_v3_companion_radio_ble-v1.9.1-abc1234.bin', bytes: s3Image },
          heltec,
        ),
      ),
    ).toBe('IMAGE_NOT_FULL_IMAGE');
  });

  it('refuses a Meshtastic image selected while flashing a MeshCore board', async () => {
    expect(
      await codeOf(
        planDeviceFirmware(
          { name: 'firmware-heltec-v3-2.7.15.567b8ea.factory.bin', bytes: s3Image },
          heltec,
        ),
      ),
    ).toBe('IMAGE_BOARD_MISMATCH');
  });
});

describe('planDeviceFirmware — nRF52 DFU', () => {
  const mtRak = board('meshtastic:rak4631');
  const mcRak = board('meshcore:rak4631');

  it('accepts a DFU zip whose own name identifies the board', async () => {
    const dfu = makeDfuEntries();
    const bytes = fakeZipBytes(1);
    const plan = await planDeviceFirmware(
      { name: 'firmware-rak4631-2.7.15.567b8ea-ota.zip', bytes },
      mtRak,
      { readEntries: () => Promise.resolve(dfu.entries) },
    );
    expect(plan.kind).toBe('nrf52');
    if (plan.kind !== 'nrf52') return;
    expect(plan.dfuPackage).toBe(bytes);
    expect(plan.releaseLabel).toBe('2.7.15.567b8ea');
  });

  it('extracts the nested DFU package from a multi-board release zip', async () => {
    const dfu = makeDfuEntries();
    const nested = fakeZipBytes(2);
    const outer = fakeZipBytes(3);
    const plan = await planDeviceFirmware(
      { name: 'firmware-nrf52840-2.7.15.567b8ea.zip', bytes: outer },
      mtRak,
      {
        readEntries: (bytes) =>
          Promise.resolve(
            bytes === nested
              ? dfu.entries
              : [
                  fileEntry('firmware-rak4631-2.7.15.567b8ea-ota.zip', nested),
                  fileEntry('firmware-rak4631-2.7.15.567b8ea.uf2', new Uint8Array(4)),
                  fileEntry('firmware-t-echo-2.7.15.567b8ea-ota.zip', fakeZipBytes(9)),
                ],
          ),
      },
    );
    expect(plan.kind === 'nrf52' && plan.dfuPackage).toBe(nested);
  });

  it('refuses a DFU zip named for another board', async () => {
    const dfu = makeDfuEntries();
    expect(
      await codeOf(
        planDeviceFirmware(
          { name: 'RAK_4631_companion_radio_ble-v1.9.1-abc1234.zip', bytes: fakeZipBytes() },
          mtRak,
          { readEntries: () => Promise.resolve(dfu.entries) },
        ),
      ),
    ).toBe('IMAGE_BOARD_MISMATCH');
  });

  it('accepts MeshCore RAK4631 companion zips and refuses UF2 files', async () => {
    const dfu = makeDfuEntries();
    const ok = await planDeviceFirmware(
      { name: 'RAK_4631_companion_radio_usb-v1.9.1-abc1234.zip', bytes: fakeZipBytes() },
      mcRak,
      { readEntries: () => Promise.resolve(dfu.entries) },
    );
    expect(ok.kind).toBe('nrf52');
    expect(
      await codeOf(
        planDeviceFirmware(
          { name: 'RAK_4631_companion_radio_usb-v1.9.1-abc1234.uf2', bytes: new Uint8Array(64) },
          mcRak,
        ),
      ),
    ).toBe('IMAGE_NOT_FULL_IMAGE');
  });

  it('refuses a zip that is the DFU package but does not name the board', async () => {
    const dfu = makeDfuEntries();
    expect(
      await codeOf(
        planDeviceFirmware({ name: 'update.zip', bytes: fakeZipBytes() }, mtRak, {
          readEntries: () => Promise.resolve(dfu.entries),
        }),
      ),
    ).toBe('IMAGE_NAME_UNRECOGNIZED');
  });
});

describe('validateNrf52DfuPackage', () => {
  it('accepts an application-only package with a matching init-packet CRC', async () => {
    await expect(validateNrf52DfuPackage(makeDfuEntries().entries)).resolves.toBeUndefined();
  });

  it('accepts init packets that list softdevice requirements', async () => {
    await expect(
      validateNrf52DfuPackage(makeDfuEntries({ sdCount: 2 }).entries),
    ).resolves.toBeUndefined();
  });

  it('refuses a CRC mismatch (corrupt or tampered firmware)', async () => {
    expect(await codeOf(validateNrf52DfuPackage(makeDfuEntries({ crcDelta: 1 }).entries))).toBe(
      'DFU_PACKAGE_INVALID',
    );
  });

  it('refuses packages that also contain bootloader / softdevice images', async () => {
    const dfu = makeDfuEntries({
      manifest: {
        manifest: {
          application: { bin_file: 'app.bin', dat_file: 'app.dat' },
          bootloader: { bin_file: 'bl.bin', dat_file: 'bl.dat' },
        },
      },
    });
    expect(await codeOf(validateNrf52DfuPackage(dfu.entries))).toBe('DFU_PACKAGE_INVALID');
  });

  it('refuses missing manifest, invalid JSON, path traversal and missing payload files', async () => {
    const dfu = makeDfuEntries();
    expect(await codeOf(validateNrf52DfuPackage(dfu.entries.slice(1)))).toBe('DFU_PACKAGE_INVALID');
    expect(
      await codeOf(
        validateNrf52DfuPackage([
          fileEntry('manifest.json', textBytes('{nope')),
          ...dfu.entries.slice(1),
        ]),
      ),
    ).toBe('DFU_PACKAGE_INVALID');
    expect(
      await codeOf(
        validateNrf52DfuPackage(
          makeDfuEntries({
            manifest: {
              manifest: { application: { bin_file: '../app.bin', dat_file: 'app.dat' } },
            },
          }).entries,
        ),
      ),
    ).toBe('DFU_PACKAGE_INVALID');
    expect(await codeOf(validateNrf52DfuPackage(dfu.entries.slice(0, 2)))).toBe(
      'DFU_PACKAGE_INVALID',
    );
  });

  it('refuses a truncated init packet', async () => {
    const dfu = makeDfuEntries();
    const entries = [...dfu.entries.slice(0, 2), fileEntry('app.dat', new Uint8Array(6))];
    expect(await codeOf(validateNrf52DfuPackage(entries))).toBe('DFU_PACKAGE_INVALID');
  });

  it('refuses secure-DFU style init packets (protobuf, wrong length/CRC)', async () => {
    const dfu = makeDfuEntries();
    const entries = [
      ...dfu.entries.slice(0, 2),
      fileEntry('app.dat', new Uint8Array(40).fill(0x0a)),
    ];
    expect(await codeOf(validateNrf52DfuPackage(entries))).toBe('DFU_PACKAGE_INVALID');
  });
});

describe('checksum handling', () => {
  const heltecName = 'firmware-heltec-v3-2.7.15.567b8ea.factory.bin';
  const image = makeEspImage({ chipId: S3 });
  const digest = sha256Hex(image);
  const heltec = board('meshtastic:heltec-v3');

  it('parses sha256 digests with prefixes, whitespace, and case', () => {
    expect(parseExpectedSha256(`SHA256: ${digest.toUpperCase()}\n`)).toBe(digest);
    expect(parseExpectedSha256('  ')).toBeNull();
    expect(parseExpectedSha256('abc')).toBe('');
  });

  it('accepts a matching expected digest and blocks a mismatch', async () => {
    await expect(
      planDeviceFirmware({ name: heltecName, bytes: image }, heltec, { expectedSha256: digest }),
    ).resolves.toMatchObject({ kind: 'esp32' });
    expect(
      await codeOf(
        planDeviceFirmware({ name: heltecName, bytes: image }, heltec, {
          expectedSha256: 'a'.repeat(64),
        }),
      ),
    ).toBe('CHECKSUM_MISMATCH');
    expect(
      await codeOf(
        planDeviceFirmware({ name: heltecName, bytes: image }, heltec, { expectedSha256: 'xyz' }),
      ),
    ).toBe('CHECKSUM_INVALID');
  });

  it('treats a blank expected digest as not provided', async () => {
    await expect(
      planDeviceFirmware({ name: heltecName, bytes: image }, heltec, { expectedSha256: '   ' }),
    ).resolves.toMatchObject({ kind: 'esp32' });
  });
});

describe('readZipEntries (real zip.js round trip)', () => {
  it('lists files and reads their bytes, skipping directories', async () => {
    const { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } = await import('@zip.js/zip.js');
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add('dir/a.bin', new Uint8ArrayReader(new Uint8Array([1, 2, 3])));
    const zipBytes = await writer.close();

    const entries = await readZipEntries(zipBytes);
    expect(entries.map((entry) => entry.name)).toEqual(['dir/a.bin']);
    expect(Array.from(await (entries[0]?.read() ?? Promise.resolve(new Uint8Array())))).toEqual([
      1, 2, 3,
    ]);
  });
});
