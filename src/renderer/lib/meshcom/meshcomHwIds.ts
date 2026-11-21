/**
 * MeshCom hardware ID → display label (on-air / EXTUDP `hw_id`).
 * Source: https://icssw.org/en/meshcom-2-0-protokoll/ MeshCom hardware table.
 */

export interface MeshcomHwInfo {
  id: number;
  abbreviation: string;
  hwType: string;
  mcu: string;
  lora: string;
  version?: string;
}

export const MESHCOM_HW_IDS: Readonly<Record<number, MeshcomHwInfo>> = {
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
