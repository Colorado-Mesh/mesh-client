/**
 * Firmware image validation for Meshtastic / MeshCore device flashing.
 *
 * Pure planning layer: given the user's file (bare `.bin` or release `.zip`) and the selected
 * {@link DeviceFlashBoard}, either return a {@link DeviceFirmwarePlan} that is safe to hand to
 * the flasher, or throw a {@link DeviceFirmwareError}. Anything ambiguous is refused.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

import { bytesToHex } from '@/shared/hexBytes';

import {
  DEVICE_FLASH_BOARDS,
  type DeviceFlashBoard,
  type DeviceFlashFamily,
} from './deviceFirmwareBoards';
import { nrf52DfuCrc16 } from './nrf52DfuFlasher';

export type DeviceFirmwareErrorCode =
  | 'IMAGE_EMPTY'
  | 'IMAGE_NAME_UNRECOGNIZED'
  | 'IMAGE_BOARD_MISMATCH'
  | 'IMAGE_NOT_FOUND_FOR_BOARD'
  | 'IMAGE_NOT_FULL_IMAGE'
  | 'IMAGE_NOT_COMPANION'
  | 'IMAGE_AMBIGUOUS'
  | 'IMAGE_HEADER_INVALID'
  | 'IMAGE_CHIP_MISMATCH'
  | 'IMAGE_TOO_LARGE'
  | 'IMAGE_TOO_SMALL'
  | 'DFU_PACKAGE_INVALID'
  | 'CHECKSUM_INVALID'
  | 'CHECKSUM_MISMATCH';

/** Validation failure; `message` is the machine code (matches `deviceFirmware.errors.<code>`). */
export class DeviceFirmwareError extends Error {
  readonly code: DeviceFirmwareErrorCode;
  /** Optional human-readable specifics (e.g. the other board the image targets). */
  readonly detail: string | undefined;

  constructor(code: DeviceFirmwareErrorCode, detail?: string) {
    super(code);
    this.name = 'DeviceFirmwareError';
    this.code = code;
    this.detail = detail;
  }
}

export function isDeviceFirmwareError(err: unknown): err is DeviceFirmwareError {
  return err instanceof DeviceFirmwareError;
}

export interface EspFlashImage {
  /** File name the image came from (display / logs only). */
  name: string;
  address: number;
  data: Uint8Array;
}

interface PlanBase {
  board: DeviceFlashBoard;
  /** Release/version label parsed from the asset name (may be empty). */
  releaseLabel: string;
  /** Name of the file the user selected. */
  sourceName: string;
  /** SHA-256 of the selected file (compare with the digest GitHub shows for the asset). */
  fileSha256: string;
  /** SHA-256 of the exact payload that will be written (image / DFU package). */
  payloadSha256: string;
  /** Bytes that will be sent to the device. */
  payloadBytes: number;
}

export interface Esp32DeviceFirmwarePlan extends PlanBase {
  kind: 'esp32';
  images: EspFlashImage[];
}

export interface Nrf52DeviceFirmwarePlan extends PlanBase {
  kind: 'nrf52';
  /** Legacy serial-DFU package (manifest.json + .bin + .dat) validated against its init packet. */
  dfuPackage: Uint8Array;
}

export type DeviceFirmwarePlan = Esp32DeviceFirmwarePlan | Nrf52DeviceFirmwarePlan;

export interface FirmwareFileEntry {
  name: string;
  read(): Promise<Uint8Array>;
}

export type ReadZipEntries = (bytes: Uint8Array) => Promise<FirmwareFileEntry[]>;

export const ESP_IMAGE_MAGIC = 0xe9;
/** `chip_id` field of the extended ESP image header (offset 12, uint16 LE). */
export const ESP_IMAGE_CHIP_ID: Record<'esp32' | 'esp32s3', number> = {
  esp32: 0x0000,
  esp32s3: 0x0009,
};
/** Full-flash images are always several hundred KiB; anything smaller is not a factory image. */
export const MIN_ESP32_FULL_IMAGE_BYTES = 0x20000;
const ESP32_CLASSIC_BOOTLOADER_OFFSET = 0x1000;
const ESP_FLASH_ADDRESS_FULL_IMAGE = 0x0;

/** Meshtastic release version: `2.7.15` or `2.7.15.567b8ea`. */
function isReleaseVersion(text: string): boolean {
  const parts = text.split('.');
  if (parts.length !== 3 && parts.length !== 4) return false;
  if (!parts.slice(0, 3).every((part) => /^\d+$/.test(part))) return false;
  return parts.length === 3 || /^[0-9a-f]{6,12}$/.test(parts.slice(3).join('.'));
}

/** True when `text` starts with `major.minor.patch` followed by `.` or `-`. */
function startsWithReleaseVersion(text: string): boolean {
  const m = /^\d+\.\d+\.\d+/.exec(text);
  return m !== null && /^[.-]/.test(text.slice(m[0].length));
}

const MESHCORE_MERGED_RE = /^[a-z0-9]+-v?(.+)-merged\.bin$/;
const MESHCORE_DFU_RE = /^[a-z0-9]+-v?(.+)\.zip$/;

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

interface AssetMatch {
  releaseLabel: string;
}

/** Asset naming per protocol/family. `full` = the image this flasher writes. */
function matchAsset(board: DeviceFlashBoard, fileName: string): AssetMatch | null {
  const name = baseName(fileName).toLowerCase();
  if (board.protocol === 'meshtastic' && board.meshtasticSlug) {
    const prefix = `firmware-${board.meshtasticSlug}-`;
    if (!name.startsWith(prefix)) return null;
    let rest = name.slice(prefix.length);
    if (board.family === 'nrf52840') {
      if (!rest.endsWith('.zip')) return null;
      rest = rest.slice(0, -'.zip'.length);
      if (rest.endsWith('-ota')) rest = rest.slice(0, -'-ota'.length);
    } else {
      if (!rest.endsWith('.factory.bin')) return null;
      rest = rest.slice(0, -'.factory.bin'.length);
    }
    return isReleaseVersion(rest) ? { releaseLabel: rest } : null;
  }
  if (board.protocol === 'meshcore' && board.meshcorePrefix) {
    const prefix = `${board.meshcorePrefix}_companion_radio_`;
    if (!name.startsWith(prefix)) return null;
    const rest = name.slice(prefix.length);
    const m = (board.family === 'nrf52840' ? MESHCORE_DFU_RE : MESHCORE_MERGED_RE).exec(rest);
    const releaseLabel = m?.[1];
    return releaseLabel ? { releaseLabel } : null;
  }
  return null;
}

/** True when the name is an asset (any kind) for `board` that is not the image we flash. */
function isOtherAssetForBoard(board: DeviceFlashBoard, fileName: string): boolean {
  const name = baseName(fileName).toLowerCase();
  if (board.protocol === 'meshtastic' && board.meshtasticSlug) {
    const prefix = `firmware-${board.meshtasticSlug}-`;
    return name.startsWith(prefix) && startsWithReleaseVersion(name.slice(prefix.length));
  }
  if (board.protocol === 'meshcore' && board.meshcorePrefix) {
    return name.startsWith(`${board.meshcorePrefix}_companion_radio_`);
  }
  return false;
}

/** MeshCore repeater / room-server / etc. images for this board (not companion radio). */
function isNonCompanionMeshcoreAsset(board: DeviceFlashBoard, fileName: string): boolean {
  if (board.protocol !== 'meshcore' || !board.meshcorePrefix) return false;
  const name = baseName(fileName).toLowerCase();
  return name.startsWith(`${board.meshcorePrefix}_`) && !name.includes('_companion_radio_');
}

function otherMatchingBoard(
  family: DeviceFlashFamily | null,
  board: DeviceFlashBoard,
  fileName: string,
): DeviceFlashBoard | null {
  for (const other of DEVICE_FLASH_BOARDS) {
    if (other.id === board.id) continue;
    if (family !== null && other.family !== family) continue;
    if (matchAsset(other, fileName) || isOtherAssetForBoard(other, fileName)) return other;
  }
  return null;
}

function isZipBytes(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
}

/** Read every file entry of a zip with zip.js (CRC32 is verified while reading). */
export const readZipEntries: ReadZipEntries = async (bytes) => {
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  const entries = await reader.getEntries();
  const files: FirmwareFileEntry[] = [];
  for (const entry of entries) {
    if (entry.directory) continue;
    files.push({
      name: entry.filename,
      read: async () => entry.getData(new Uint8ArrayWriter()),
    });
  }
  return files;
};

/** Hex SHA-256 of `bytes` (lowercase). */
export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/** Parse a user-supplied digest (`sha256:` prefix and whitespace tolerated). */
export function parseExpectedSha256(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^sha-?256\s*[:=]?\s*/i, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  if (cleaned === '') return null;
  return /^[0-9a-f]{64}$/.test(cleaned) ? cleaned : '';
}

/** Header offset of the first-stage bootloader image within a full-flash image, or `null`. */
function espHeaderOffset(data: Uint8Array): number | null {
  if (data[0] === ESP_IMAGE_MAGIC) return 0;
  // Classic ESP32 full images are padded with 0xFF; the bootloader starts at 0x1000.
  if (
    data.length > ESP32_CLASSIC_BOOTLOADER_OFFSET + 16 &&
    data[ESP32_CLASSIC_BOOTLOADER_OFFSET] === ESP_IMAGE_MAGIC
  ) {
    return ESP32_CLASSIC_BOOTLOADER_OFFSET;
  }
  return null;
}

export interface EspImageHeader {
  chipId: number;
  /** Flash size recorded in the image header (bytes), or `null` when the code is unknown. */
  flashBytes: number | null;
}

/** Parse the ESP image header of a full-flash image written at address 0. */
export function parseEspImageHeader(data: Uint8Array): EspImageHeader | null {
  const offset = espHeaderOffset(data);
  if (offset === null) return null;
  const chipId = (data[offset + 12] ?? 0) | ((data[offset + 13] ?? 0) << 8);
  const sizeCode = (data[offset + 3] ?? 0) >> 4;
  const flashBytes = sizeCode <= 7 ? (1 << sizeCode) * 1024 * 1024 : null;
  return { chipId, flashBytes };
}

function validateEsp32Image(board: DeviceFlashBoard, data: Uint8Array): void {
  if (data.byteLength === 0) throw new DeviceFirmwareError('IMAGE_EMPTY');
  if (data.byteLength < MIN_ESP32_FULL_IMAGE_BYTES)
    throw new DeviceFirmwareError('IMAGE_TOO_SMALL');
  const header = parseEspImageHeader(data);
  if (!header) throw new DeviceFirmwareError('IMAGE_HEADER_INVALID');
  const expectedChipId = ESP_IMAGE_CHIP_ID[board.family === 'esp32s3' ? 'esp32s3' : 'esp32'];
  if (header.chipId !== expectedChipId) throw new DeviceFirmwareError('IMAGE_CHIP_MISMATCH');
  const flashBytes = board.flashBytes ?? 0;
  if (flashBytes > 0) {
    if (data.byteLength > flashBytes) throw new DeviceFirmwareError('IMAGE_TOO_LARGE');
    if (header.flashBytes !== null && header.flashBytes > flashBytes) {
      throw new DeviceFirmwareError('IMAGE_TOO_LARGE');
    }
  }
}

function u16le(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8);
}

function safeEntryName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    !name.startsWith('/') &&
    !name.split(/[\\/]/).includes('..')
  );
}

/**
 * Validate a legacy (Adafruit / Nordic nrfutil) serial-DFU package: application-only manifest,
 * both payload files present, and the init packet's CRC16 equals the firmware's CRC16.
 */
export async function validateNrf52DfuPackage(
  entries: readonly FirmwareFileEntry[],
): Promise<void> {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const manifestEntry = byName.get('manifest.json');
  if (!manifestEntry) throw new DeviceFirmwareError('DFU_PACKAGE_INVALID', 'manifest.json');

  let manifest: unknown;
  try {
    manifest = (
      JSON.parse(new TextDecoder().decode(await manifestEntry.read())) as {
        manifest?: unknown;
      }
    ).manifest;
  } catch {
    // catch-no-log-ok invalid manifest surfaces as a typed validation error
    throw new DeviceFirmwareError('DFU_PACKAGE_INVALID', 'manifest.json');
  }
  if (manifest === null || typeof manifest !== 'object') {
    throw new DeviceFirmwareError('DFU_PACKAGE_INVALID', 'manifest.json');
  }
  const record = manifest as Record<string, unknown>;
  // The DFU flasher only writes `application`; never silently skip a bootloader/softdevice.
  const keys = Object.keys(record).filter(
    (key) => record[key] !== undefined && record[key] !== null,
  );
  if (keys.length !== 1 || keys[0] !== 'application') {
    throw new DeviceFirmwareError('DFU_PACKAGE_INVALID', 'application-only');
  }
  const app = record.application as { bin_file?: unknown; dat_file?: unknown } | null;
  if (!app || !safeEntryName(app.bin_file) || !safeEntryName(app.dat_file)) {
    throw new DeviceFirmwareError('DFU_PACKAGE_INVALID', 'application');
  }
  const binEntry = byName.get(app.bin_file);
  const datEntry = byName.get(app.dat_file);
  if (!binEntry || !datEntry) throw new DeviceFirmwareError('DFU_PACKAGE_INVALID', 'files');

  const [bin, dat] = await Promise.all([binEntry.read(), datEntry.read()]);
  if (bin.byteLength === 0) throw new DeviceFirmwareError('IMAGE_EMPTY');
  // Init packet: dev_type u16, dev_rev u16, app_ver u32, sd_count u16, sd_req[sd_count] u16, crc16
  if (dat.byteLength < 12) throw new DeviceFirmwareError('DFU_PACKAGE_INVALID', 'init-packet');
  const sdCount = u16le(dat, 8);
  if (dat.byteLength !== 10 + sdCount * 2 + 2) {
    throw new DeviceFirmwareError('DFU_PACKAGE_INVALID', 'init-packet');
  }
  if (u16le(dat, dat.byteLength - 2) !== nrf52DfuCrc16(bin)) {
    throw new DeviceFirmwareError('DFU_PACKAGE_INVALID', 'crc');
  }
}

export interface PlanDeviceFirmwareOptions {
  /** Optional user-pasted SHA-256 (from the release page); mismatch refuses the file. */
  expectedSha256?: string;
  /** Test seam for zip reading. */
  readEntries?: ReadZipEntries;
}

function checkExpectedSha256(expected: string | undefined, hashes: readonly string[]): void {
  if (expected === undefined || expected.trim() === '') return;
  const parsed = parseExpectedSha256(expected);
  if (parsed === null || parsed === '') throw new DeviceFirmwareError('CHECKSUM_INVALID');
  if (!hashes.includes(parsed)) throw new DeviceFirmwareError('CHECKSUM_MISMATCH');
}

function pickSingle(
  entries: readonly FirmwareFileEntry[],
  board: DeviceFlashBoard,
): { entry: FirmwareFileEntry; match: AssetMatch } | null {
  const matches = entries.flatMap((entry) => {
    const match = matchAsset(board, entry.name);
    return match ? [{ entry, match }] : [];
  });
  if (matches.length > 1) throw new DeviceFirmwareError('IMAGE_AMBIGUOUS');
  return matches[0] ?? null;
}

/** Explain why a bare (non-zip) file or an empty zip search did not yield an image. */
function refuseUnmatched(board: DeviceFlashBoard, names: readonly string[], isZip: boolean): never {
  for (const name of names) {
    if (isNonCompanionMeshcoreAsset(board, name))
      throw new DeviceFirmwareError('IMAGE_NOT_COMPANION');
  }
  for (const name of names) {
    const other = otherMatchingBoard(null, board, name);
    if (other) throw new DeviceFirmwareError('IMAGE_BOARD_MISMATCH', other.label);
  }
  if (isZip) throw new DeviceFirmwareError('IMAGE_NOT_FOUND_FOR_BOARD');
  for (const name of names) {
    if (isOtherAssetForBoard(board, name)) throw new DeviceFirmwareError('IMAGE_NOT_FULL_IMAGE');
  }
  throw new DeviceFirmwareError('IMAGE_NAME_UNRECOGNIZED');
}

/**
 * Resolve the user's file into a flash plan for `board`, or throw {@link DeviceFirmwareError}.
 * The selected board is authoritative: assets named for any other board are refused.
 */
export async function planDeviceFirmware(
  file: { name: string; bytes: Uint8Array },
  board: DeviceFlashBoard,
  options: PlanDeviceFirmwareOptions = {},
): Promise<DeviceFirmwarePlan> {
  const { readEntries = readZipEntries } = options;
  if (file.bytes.byteLength === 0) throw new DeviceFirmwareError('IMAGE_EMPTY');
  const fileSha256 = sha256Hex(file.bytes);
  const zip = isZipBytes(file.bytes);

  if (board.family === 'nrf52840') {
    if (!zip) refuseUnmatched(board, [file.name], false);
    const entries = await readEntries(file.bytes);
    let dfuBytes: Uint8Array;
    let releaseLabel: string;
    if (entries.some((entry) => entry.name === 'manifest.json')) {
      // The selected file is itself the DFU package — its own name must identify the board.
      const match = matchAsset(board, file.name);
      if (!match) refuseUnmatched(board, [file.name], false);
      dfuBytes = file.bytes;
      releaseLabel = match.releaseLabel;
    } else {
      const picked = pickSingle(entries, board);
      if (!picked) {
        refuseUnmatched(board, [file.name, ...entries.map((entry) => entry.name)], true);
      }
      dfuBytes = await picked.entry.read();
      releaseLabel = picked.match.releaseLabel;
    }
    if (!isZipBytes(dfuBytes)) throw new DeviceFirmwareError('DFU_PACKAGE_INVALID', 'zip');
    await validateNrf52DfuPackage(await readEntries(dfuBytes));
    const payloadSha256 = sha256Hex(dfuBytes);
    checkExpectedSha256(options.expectedSha256, [fileSha256, payloadSha256]);
    return {
      kind: 'nrf52',
      board,
      releaseLabel,
      sourceName: file.name,
      fileSha256,
      payloadSha256,
      payloadBytes: dfuBytes.byteLength,
      dfuPackage: dfuBytes,
    };
  }

  let name: string;
  let data: Uint8Array;
  let releaseLabel: string;
  if (zip) {
    const entries = await readEntries(file.bytes);
    const picked = pickSingle(entries, board);
    if (!picked) {
      refuseUnmatched(board, [file.name, ...entries.map((entry) => entry.name)], true);
    }
    name = picked.entry.name;
    data = await picked.entry.read();
    releaseLabel = picked.match.releaseLabel;
  } else {
    const match = matchAsset(board, file.name);
    if (!match) refuseUnmatched(board, [file.name], false);
    name = file.name;
    data = file.bytes;
    releaseLabel = match.releaseLabel;
  }
  validateEsp32Image(board, data);
  const payloadSha256 = sha256Hex(data);
  checkExpectedSha256(options.expectedSha256, [fileSha256, payloadSha256]);
  return {
    kind: 'esp32',
    board,
    releaseLabel,
    sourceName: file.name,
    fileSha256,
    payloadSha256,
    payloadBytes: data.byteLength,
    images: [{ name: baseName(name), address: ESP_FLASH_ADDRESS_FULL_IMAGE, data }],
  };
}
