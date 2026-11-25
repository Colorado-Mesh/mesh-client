/**
 * MeshCom hardware ID → display label (on-air / EXTUDP `hw_id`).
 * Source: https://icssw.org/en/meshcom-2-0-protokoll/ MeshCom hardware table.
 */

interface MeshcomHwInfo {
  id: number;
  abbreviation: string;
  hwType: string;
  mcu: string;
  lora: string;
  version?: string;
}

const MESHCOM_HW_IDS: Readonly<Record<number, MeshcomHwInfo>> = {
  1: {
    id: 1,
    abbreviation: 'TLORA',
    hwType: 'TTGO ESP32 Paxcounter',
    mcu: 'ESP32',
    lora: 'SX1278',
    version: 'V2',
  },
  2: {
    id: 2,
    abbreviation: 'TLORA',
    hwType: 'TTGO ESP32 Paxcounter',
    mcu: 'ESP32',
    lora: 'SX1278',
    version: 'V1',
  },
  3: {
    id: 3,
    abbreviation: 'TLORA',
    hwType: 'TTGO ESP32 Paxcounter',
    mcu: 'ESP32',
    lora: 'SX1278',
    version: 'V2 1.6',
  },
  4: {
    id: 4,
    abbreviation: 'T-BEAM',
    hwType: 'TTGO T-Beam',
    mcu: 'ESP32',
    lora: 'SX1278',
    version: '1.1',
  },
  5: {
    id: 5,
    abbreviation: 'T-BEAM-1268',
    hwType: 'TTGO T-Beam',
    mcu: 'ESP32',
    lora: 'SX1268',
    version: '1.1 1268',
  },
  6: {
    id: 6,
    abbreviation: 'T-BEAM-0.7',
    hwType: 'TTGO T-Beam',
    mcu: 'ESP32',
    lora: 'SX1262',
    version: '0.7',
  },
  7: {
    id: 7,
    abbreviation: 'T-ECHO',
    hwType: 'T-Echo LoRa SX1262',
    mcu: 'nRF',
    lora: 'SX1262',
  },
  8: {
    id: 8,
    abbreviation: 'T-DECK',
    hwType: 'T-Deck',
    mcu: 'ESP32-S3',
    lora: 'SX1262',
  },
  9: {
    id: 9,
    abbreviation: 'RAK4631',
    hwType: 'Wisblock RAK4631',
    mcu: 'nRF',
    lora: 'Wisblock nRF',
  },
  10: {
    id: 10,
    abbreviation: 'HELTEC-V2-1',
    hwType: 'WiFi LoRa 32 v2',
    mcu: 'ESP32',
    lora: 'SX1262',
    version: 'V2',
  },
  11: {
    id: 11,
    abbreviation: 'HELTEC-V1',
    hwType: 'WiFi LoRa 32 v1',
    mcu: 'ESP32',
    lora: 'SX1276',
    version: 'V1',
  },
  12: {
    id: 12,
    abbreviation: 'TBEAM-AXP2101',
    hwType: 'TTGO T-Beam',
    mcu: 'ESP32',
    lora: 'SX1278',
  },
  39: {
    id: 39,
    abbreviation: 'EBYTE-E22',
    hwType: 'Ebyte Lora E22',
    mcu: 'ESP32',
    lora: 'SX1268',
  },
  40: {
    id: 40,
    abbreviation: 'T5-EPAPER',
    hwType: 'LilyGO T5 E-Paper',
    mcu: 'ESP32',
    lora: 'SX1262',
  },
  41: {
    id: 41,
    abbreviation: 'HELTEC-TRACK',
    hwType: 'Heltec Wireless Tracker',
    mcu: 'ESP32-S3',
    lora: 'SX1262',
  },
  42: {
    id: 42,
    abbreviation: 'HELTEC-STICK',
    hwType: 'Heltec Wireless Stick v3',
    mcu: 'ESP32-S3',
    lora: 'SX1262',
  },
  43: {
    id: 43,
    abbreviation: 'HELTEC-V3',
    hwType: 'WiFi LoRa 32 v3',
    mcu: 'ESP32-S3',
    lora: 'SX1262',
    version: 'V3',
  },
  44: {
    id: 44,
    abbreviation: 'HELTEC-E290',
    hwType: 'Heltec E-Ink E290',
    mcu: 'ESP32-S3',
    lora: 'SX1262',
  },
  45: {
    id: 45,
    abbreviation: 'T-BEAM-1262',
    hwType: 'TTGO T-Beam',
    mcu: 'ESP32',
    lora: 'SX1262',
    version: '1.2',
  },
  46: {
    id: 46,
    abbreviation: 'T-DECK-PLUS',
    hwType: 'LilyGO T-Deck Plus',
    mcu: 'ESP32-S3',
    lora: 'SX1262',
  },
  47: {
    id: 47,
    abbreviation: 'TBEAM-SUP',
    hwType: 'TTGO T-Beam Supreme',
    mcu: 'ESP32-S3',
    lora: 'SX1262',
  },
  48: {
    id: 48,
    abbreviation: 'EBYTE-E22-S3',
    hwType: 'Ebyte Lora E22',
    mcu: 'ESP32-S3',
    lora: 'SX1268',
  },
  49: {
    id: 49,
    abbreviation: 'T-LORA-PAGER',
    hwType: 'LilyGO T-Lora Pager',
    mcu: 'ESP32-S3',
    lora: 'SX1262',
  },
  50: {
    id: 50,
    abbreviation: 'T-DECK-PRO',
    hwType: 'LilyGO T-Deck Pro',
    mcu: 'ESP32-S3',
    lora: 'SX1262',
  },
  51: {
    id: 51,
    abbreviation: 'T-BEAM-1W',
    hwType: 'LilyGO T-Beam 1W',
    mcu: 'ESP32',
    lora: 'SX1262',
  },
  52: {
    id: 52,
    abbreviation: 'HELTEC-V4',
    hwType: 'Heltec WiFi LoRa 32 v4',
    mcu: 'ESP32-S3',
    lora: 'SX1262',
  },
  53: {
    id: 53,
    abbreviation: 'T-ETH-ELITE',
    hwType: 'LilyGO T-ETH Elite',
    mcu: 'ESP32-S3',
    lora: 'SX1262',
  },
  54: {
    id: 54,
    abbreviation: 'HELTEC-T114',
    hwType: 'Heltec T114',
    mcu: 'nRF',
    lora: 'SX1262',
  },
  55: {
    id: 55,
    abbreviation: 'T3-S3-V1.3',
    hwType: 'LilyGO T3-S3',
    mcu: 'ESP32-S3',
    lora: 'SX1262',
    version: 'V1.3',
  },
  56: {
    id: 56,
    abbreviation: 'T-CONNECT-PRO',
    hwType: 'LilyGO T-Connect Pro',
    mcu: 'ESP32-S3',
    lora: 'SX1262',
  },
  57: {
    id: 57,
    abbreviation: 'HELTEC-WPAPER',
    hwType: 'Heltec Wireless Paper',
    mcu: 'ESP32-S3',
    lora: 'SX1262',
  },
  58: {
    id: 58,
    abbreviation: 'HELTEC-E213',
    hwType: 'Heltec Vision Master E213',
    mcu: 'ESP32-S3',
    lora: 'SX1262',
  },
  59: {
    id: 59,
    abbreviation: 'ESP32-LORAPRS-E22',
    hwType: 'ESP32 LoRaPRS (Ebyte E22)',
    mcu: 'ESP32',
    lora: 'SX1268',
  },
  60: {
    id: 60,
    abbreviation: 'ESP32-LORAPRS-RA01',
    hwType: 'ESP32 LoRaPRS (Ai-Thinker RA-01)',
    mcu: 'ESP32',
    lora: 'SX1278',
  },
  61: {
    id: 61,
    abbreviation: 'T-WATCH-S3',
    hwType: 'LilyGO T-Watch S3',
    mcu: 'ESP32-S3',
    lora: 'SX1262',
  },
};

/** Display abbreviation for a hardware id, or `HW#n` when unknown. */
export function meshcomHwLabel(hwId: number | null | undefined): string {
  if (hwId == null || !Number.isFinite(hwId)) return '';
  if (!Object.hasOwn(MESHCOM_HW_IDS, hwId)) return `HW#${hwId}`;
  return MESHCOM_HW_IDS[hwId].abbreviation;
}

/**
 * Node-detail hardware line from a stored MeshCom `hw_model` (abbreviation or `HW#n`).
 * Returns null when empty so callers can omit the row.
 */
export function meshcomHwDisplay(stored: string | null | undefined): string | null {
  const raw = typeof stored === 'string' ? stored.trim() : '';
  if (!raw) return null;
  for (const info of Object.values(MESHCOM_HW_IDS)) {
    if (info.abbreviation !== raw) continue;
    const ver = info.version ? ` ${info.version}` : '';
    return `${info.abbreviation} · ${info.hwType}${ver}`;
  }
  return raw;
}

/** Format EXTUDP `firmware` + optional `fw_sub` for node detail. */
export function meshcomFirmwareDisplay(
  firmware: string | number | null | undefined,
  fwSub?: string | null,
): string | null {
  const base =
    firmware == null || firmware === ''
      ? ''
      : typeof firmware === 'number'
        ? String(firmware)
        : firmware.trim();
  const sub = typeof fwSub === 'string' ? fwSub.trim() : '';
  if (!base && !sub) return null;
  if (base && sub) return `${base} (${sub})`;
  return base || sub;
}

/** English month abbreviations used in serial `--MeshCom … (build: Mon DD YYYY …)`. */
const MESHCOM_BUILD_MONTH_ABBR: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/**
 * Convert a device build stamp into the GitHub release calendar suffix (`.MM.DD`).
 * Accepts BLE `BDATE` (`YYYYMMDD-HHMMSS`) or serial `(build: Nov 22 2026 / …)` text.
 */
function meshcomBuildStampToReleaseSuffix(stamp: string | null | undefined): string | null {
  const raw = typeof stamp === 'string' ? stamp.trim() : '';
  if (!raw) return null;
  // BDATE: YYYYMMDD or YYYYMMDD-HHMMSS (split to avoid nested-optional regex).
  const ymd = /^(\d{4})(\d{2})(\d{2})/.exec(raw);
  if (ymd) {
    const rest = raw.slice(8);
    if (rest === '' || (/^-\d{6}$/.test(rest) && rest.length === 7)) {
      return `.${ymd[2]}.${ymd[3]}`;
    }
  }
  // Serial build text: "Nov 22 2026" (fixed 3-letter month + day + year).
  const serial = /\b([A-Za-z]{3}) (\d\d?) (\d{4})\b/.exec(raw);
  if (!serial) return null;
  const monthKey = serial[1].toLowerCase();
  if (!Object.hasOwn(MESHCOM_BUILD_MONTH_ABBR, monthKey)) return null;
  const month = MESHCOM_BUILD_MONTH_ABBR[monthKey];
  const day = Number.parseInt(serial[2], 10);
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  return `.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
}

/**
 * Connection / metadata display for installed MeshCom firmware.
 * Matches MeshCom-Firmware release tags (`4.40a.11.22`): collapses BLE spaced FWVER
 * (`4.40 a` → `4.40a`) and maps BLE `BDATE` / serial `(build: …)` to `.MM.DD`.
 */
export function formatMeshcomInstalledFirmware(
  fwver?: string | null,
  buildDate?: string | null,
): string | null {
  const raw = typeof fwver === 'string' ? fwver.trim() : '';
  const bdate = typeof buildDate === 'string' ? buildDate.trim() : '';
  if (!raw && !bdate) return null;

  let head = raw;
  let parenBuild: string | null = null;
  const paren = raw.indexOf('(');
  if (paren >= 0) {
    head = raw.slice(0, paren).trim();
    parenBuild = raw.slice(paren);
  }

  const collapsed = head.replace(/\s+/g, '');
  // Split base / date / -rm like normalizeMeshComVersionTag (avoid nested-optional regex).
  const baseMatch = /^(\d+\.\d+)([a-z]?)/i.exec(collapsed);
  if (baseMatch) {
    const letterBase = `${baseMatch[1]}${baseMatch[2]}`.toLowerCase();
    let rest = collapsed.slice(baseMatch[0].length);
    const dateMatch = /^\.(\d\d?)\.(\d\d?)/.exec(rest);
    if (dateMatch) {
      rest = rest.slice(dateMatch[0].length);
      const rmTail = /^-rm\d*$/i.test(rest) ? rest : '';
      if (rest === '' || rmTail) {
        return `${letterBase}.${dateMatch[1]}.${dateMatch[2]}${rmTail}`;
      }
    }
  }

  const rmMatch = /(-rm\d+)$/i.exec(collapsed);
  const withoutRm = rmMatch ? collapsed.slice(0, rmMatch.index) : collapsed;
  const base = withoutRm.toLowerCase();
  const rmTail = rmMatch ? rmMatch[1] : '';
  const suffix =
    meshcomBuildStampToReleaseSuffix(bdate) ?? meshcomBuildStampToReleaseSuffix(parenBuild);
  if (!base && !suffix) return null;
  if (!base) return suffix ? suffix.slice(1) : null;
  if (!suffix) return `${base}${rmTail}`;
  return `${base}${suffix}${rmTail}`;
}
