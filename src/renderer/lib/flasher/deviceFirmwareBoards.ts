/**
 * Narrow, deliberately small board matrix for Meshtastic / MeshCore firmware flashing.
 *
 * Fail closed: a board that is not listed here cannot be flashed from Mesh Client. Add a board
 * only after its factory image layout, chip id, and bootloader entry have been verified.
 * RNode flashing uses its own catalog (`firmwareConfigs.ts`) and is unaffected.
 */
import { meshtasticHwModelName } from '@/renderer/lib/hardwareModels';

export type DeviceFlashProtocol = 'meshtastic' | 'meshcore';

/** `esp32` = classic ESP32 (bootloader at 0x1000); `esp32s3` = ESP32-S3 (bootloader at 0x0). */
export type DeviceFlashFamily = 'esp32' | 'esp32s3' | 'nrf52840';

export interface DeviceFlashBoard {
  /** Stable id, unique across protocols (`<protocol>:<slug>`). */
  id: string;
  protocol: DeviceFlashProtocol;
  label: string;
  family: DeviceFlashFamily;
  /** Meshtastic: `HardwareModel` enum value reported in NodeInfo. */
  meshtasticHwModel?: number;
  /** Meshtastic PlatformIO env name used in release asset names (`firmware-<slug>-<ver>…`). */
  meshtasticSlug?: string;
  /** MeshCore: release asset prefix (`<prefix>_companion_radio_<transport>-<ver>…`), lowercase. */
  meshcorePrefix?: string;
  /** MeshCore: normalized (`[a-z0-9]` only) manufacturer/model strings from `deviceQuery`. */
  meshcoreModelKeys?: readonly string[];
  /** ESP32 only: total flash size in bytes (images beyond this are refused). */
  flashBytes?: number;
}

const MIB = 1024 * 1024;

export const DEVICE_FLASH_BOARDS: readonly DeviceFlashBoard[] = [
  {
    id: 'meshtastic:heltec-v3',
    protocol: 'meshtastic',
    label: 'Heltec V3',
    family: 'esp32s3',
    meshtasticHwModel: 43,
    meshtasticSlug: 'heltec-v3',
    flashBytes: 8 * MIB,
  },
  {
    id: 'meshtastic:heltec-v4',
    protocol: 'meshtastic',
    label: 'Heltec V4 (OLED)',
    family: 'esp32s3',
    meshtasticHwModel: 110,
    meshtasticSlug: 'heltec-v4',
    flashBytes: 16 * MIB,
  },
  {
    // Same hw_model 110 as OLED — detection returns ambiguous; user must pick the variant.
    id: 'meshtastic:heltec-v4-tft',
    protocol: 'meshtastic',
    label: 'Heltec V4 (TFT)',
    family: 'esp32s3',
    meshtasticHwModel: 110,
    meshtasticSlug: 'heltec-v4-tft',
    flashBytes: 16 * MIB,
  },
  {
    id: 'meshtastic:tbeam',
    protocol: 'meshtastic',
    label: 'LilyGo T-Beam',
    family: 'esp32',
    meshtasticHwModel: 4,
    meshtasticSlug: 'tbeam',
    flashBytes: 4 * MIB,
  },
  {
    id: 'meshtastic:rak4631',
    protocol: 'meshtastic',
    label: 'RAK4631 (WisBlock Core)',
    family: 'nrf52840',
    meshtasticHwModel: 9,
    meshtasticSlug: 'rak4631',
  },
  {
    id: 'meshcore:heltec-v3',
    protocol: 'meshcore',
    label: 'Heltec V3',
    family: 'esp32s3',
    meshcorePrefix: 'heltec_v3',
    meshcoreModelKeys: ['heltecv3'],
    flashBytes: 8 * MIB,
  },
  {
    id: 'meshcore:heltec-v4',
    protocol: 'meshcore',
    label: 'Heltec V4',
    family: 'esp32s3',
    meshcorePrefix: 'heltec_v4',
    meshcoreModelKeys: ['heltecv4', 'heltecv4oled'],
    flashBytes: 16 * MIB,
  },
  {
    id: 'meshcore:rak4631',
    protocol: 'meshcore',
    label: 'RAK4631 (WisBlock Core)',
    family: 'nrf52840',
    meshcorePrefix: 'rak_4631',
    meshcoreModelKeys: ['rak4631'],
  },
];

export function getDeviceFlashBoards(protocol: DeviceFlashProtocol): DeviceFlashBoard[] {
  return DEVICE_FLASH_BOARDS.filter((board) => board.protocol === protocol);
}

export function getDeviceFlashBoardById(id: string): DeviceFlashBoard | null {
  return DEVICE_FLASH_BOARDS.find((board) => board.id === id) ?? null;
}

function isDeviceFlashProtocol(protocol: string): protocol is DeviceFlashProtocol {
  return protocol === 'meshtastic' || protocol === 'meshcore';
}

/** What the connected radio told us about itself (all optional — a disconnected radio is `{}`). */
export interface DetectedFlashDevice {
  protocol: DeviceFlashProtocol;
  isConnected: boolean;
  /** `serial` | `ble` | `http` | … — serial blocks flashing (the app owns the port). */
  connectionType?: string | null;
  /** Meshtastic `hw_model` (numeric string / number / branded label). */
  meshtasticHwModel?: string | number | null;
  /** MeshCore `deviceQuery` manufacturer/model string. */
  meshcoreManufacturerModel?: string | null;
  firmwareVersion?: string | null;
  batteryPercent?: number | null;
  batteryCharging?: boolean | null;
}

export type BoardDetection =
  /** Live radio identified as a supported board — selection is locked to it. */
  | { status: 'matched'; board: DeviceFlashBoard }
  /**
   * Live radio matched multiple matrix rows (e.g. Heltec V4 OLED vs TFT share hw_model 110).
   * Selection stays unlocked so the user verifies the variant before flashing.
   */
  | { status: 'ambiguous'; reported: string; candidates: readonly DeviceFlashBoard[] }
  /** Live radio reported a model that is not in the matrix — flashing refused. */
  | { status: 'unsupported'; reported: string }
  /** Nothing to detect from (disconnected or no model reported) — manual selection + confirm. */
  | { status: 'unknown' };

export function normalizeModelKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function reportedMeshtasticModel(raw: string | number): { id: number | null; label: string } {
  const text = String(raw).trim();
  if (/^\d+$/.test(text)) {
    const id = parseInt(text, 10);
    return { id, label: meshtasticHwModelName(id) };
  }
  return { id: null, label: text };
}

/** Identify the connected radio's board family from NodeInfo / deviceQuery data. */
export function detectDeviceFlashBoard(device: DetectedFlashDevice): BoardDetection {
  if (!device.isConnected) return { status: 'unknown' };

  if (device.protocol === 'meshtastic') {
    const raw = device.meshtasticHwModel;
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      return { status: 'unknown' };
    }
    const { id, label } = reportedMeshtasticModel(raw);
    if (id === 0) return { status: 'unknown' }; // UNSET
    const boards = getDeviceFlashBoards('meshtastic');
    const byId = id === null ? [] : boards.filter((b) => b.meshtasticHwModel === id);
    const soleById = byId.length === 1 ? byId[0] : undefined;
    if (soleById) return { status: 'matched', board: soleById };
    if (byId.length > 1) return { status: 'ambiguous', reported: label, candidates: byId };
    // Legacy rows may store a branded label instead of the enum number.
    const labelKey = normalizeModelKey(label);
    const byLabel = boards.filter(
      (b) =>
        b.meshtasticHwModel !== undefined &&
        normalizeModelKey(meshtasticHwModelName(b.meshtasticHwModel)) === labelKey,
    );
    const soleByLabel = byLabel.length === 1 ? byLabel[0] : undefined;
    if (soleByLabel) return { status: 'matched', board: soleByLabel };
    if (byLabel.length > 1) return { status: 'ambiguous', reported: label, candidates: byLabel };
    return { status: 'unsupported', reported: label };
  }

  const model = device.meshcoreManufacturerModel?.trim();
  if (!model) return { status: 'unknown' };
  const key = normalizeModelKey(model);
  const match = getDeviceFlashBoards('meshcore').find((b) => b.meshcoreModelKeys?.includes(key));
  return match ? { status: 'matched', board: match } : { status: 'unsupported', reported: model };
}

/** Subset of the per-protocol connection state the flash gate needs. */
export interface FlashDeviceStateLike {
  connectionType?: string | null;
  firmwareVersion?: string;
  manufacturerModel?: string;
  batteryPercent?: number;
  batteryCharging?: boolean;
}

/**
 * Assemble {@link DetectedFlashDevice} from connection state. Returns `undefined` for protocols
 * that cannot be flashed here (Reticulum has its own RNode flasher).
 */
export function buildDetectedFlashDevice(
  protocol: string,
  input: {
    isConnected: boolean;
    state: FlashDeviceStateLike;
    meshtasticHwModel?: string | number | null;
  },
): DetectedFlashDevice | undefined {
  if (!isDeviceFlashProtocol(protocol)) return undefined;
  const { isConnected, state } = input;
  return {
    protocol,
    isConnected,
    connectionType: state.connectionType ?? null,
    meshtasticHwModel: protocol === 'meshtastic' ? (input.meshtasticHwModel ?? null) : null,
    meshcoreManufacturerModel: protocol === 'meshcore' ? (state.manufacturerModel ?? null) : null,
    firmwareVersion: state.firmwareVersion ?? null,
    batteryPercent: state.batteryPercent ?? null,
    batteryCharging: state.batteryCharging ?? null,
  };
}
