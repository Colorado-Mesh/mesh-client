/**
 * Default reply templates of widely deployed mesh ping/test bots. Only these exact
 * shapes are recognized; customized templates fall through to plain chat text.
 *
 * - MeshMonitor auto-acknowledge (Meshtastic):
 *   `🤖 Copy, 3 hops at 12:51` / `🤖 Copy, direct connection! SNR: 7.5dB RSSI: -80dBm at 12:51`
 * - Colorado-Mesh meshcore-bot-firmware (MeshCore), optional `[1a2b] ` request token:
 *   `@[bob] | 2 hops, 2-byte hashes, SNR -1.25 | recv 21:25:45[ | phrase]`
 *   `Path @[bob] 3 hops, 2-byte hashes, SNR 5.75 | 1234 -> abcd -> 0001`
 *   `Path @[bob] direct zero-hop, SNR 0.00`
 *   `Sig @[bob]: heard you at SNR 5.75 | last RSSI -92 dBm, noise -105 dBm`
 * - agessaman/meshcore-bot (MeshCore) default `test` keyword:
 *   `ack @[bob] | 01,5f (2 hops) | SNR: 15 dB | RSSI: -120 dBm | Received at: 21:25:45`
 */

export type SignalReportSource =
  | 'meshMonitor'
  | 'firmwareBot'
  | 'meshcoreBot'
  /** Person-sent client ack line (`hopReportParse.ts`); never marks the sender as a bot. */
  | 'clientAck'
  /** Person-typed `N hops to <place>` report (`hopReportParse.ts`); never marks a bot. */
  | 'hopReport';

export interface ParsedSignalReport {
  source: SignalReportSource;
  hops?: number;
  /** Where the reporter is, as typed (`hopReport` only). */
  place?: string;
  direct?: boolean;
  snr?: number;
  rssi?: number;
  noise?: number;
  /** Relay path as sent by the bot (hash prefixes), for tooltip display. */
  path?: string;
}

const NUM = String.raw`-?\d{1,3}(?:\.\d{1,2})?`;
const TOKEN = String.raw`(?:\[[0-9a-f]{4}\] )?`;
const NICK = String.raw`@\[[^\]\n]{1,64}\]`;

/* eslint-disable security/detect-non-literal-regexp -- composed from fixed literal fragments */
const MESHMONITOR_HOPS = /^🤖\uFE0F? Copy, (\d{1,2}) hops? at [^\n]{1,16}$/u;
const MESHMONITOR_DIRECT = new RegExp(
  String.raw`^🤖\uFE0F? Copy, direct connection! SNR: (${NUM}) ?dB RSSI: (-?\d{1,3}) ?dBm at [^\n]{1,16}$`,
  'u',
);
const FW_TEST = new RegExp(
  String.raw`^${TOKEN}${NICK} \| (\d{1,2}) hops?(?:, \d-byte hashes)?, SNR (${NUM}) \| recv \d{2}:\d{2}:\d{2}(?: \| [^\n]{0,200})?$`,
  'i',
);
const FW_PATH_HOPS = new RegExp(
  String.raw`^${TOKEN}Path(?: ${NICK})? (\d{1,2}) hops?, \d-byte hashes(?:, SNR (${NUM}))? \| ([0-9a-f>\- ]{2,600})$`,
  'i',
);
const FW_PATH_DIRECT = new RegExp(
  String.raw`^${TOKEN}Path(?: ${NICK})? direct zero-hop, SNR (${NUM})$`,
  'i',
);
const FW_SIG = new RegExp(
  String.raw`^${TOKEN}Sig(?: ${NICK})?: heard you at SNR (${NUM}) \| last RSSI (-?\d{1,3}) dBm, noise (-?\d{1,3}) dBm$`,
  'i',
);
const AG_TEST = new RegExp(
  String.raw`^ack ${NICK}[^|\n]{0,200} \| (direct|([0-9a-f,]{1,400}) \((\d{1,2}) hops?\))(?: \| SNR: (${NUM}|Unknown) dB)?(?: \| RSSI: (-?\d{1,3}|Unknown) dBm)? \| Received at: \d{1,2}:\d{2}(?::\d{2})?$`,
  'i',
);
/* eslint-enable security/detect-non-literal-regexp */

function num(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

function isFirmwarePath(value: string): boolean {
  return value
    .split('->')
    .map((seg) => seg.trim())
    .every((seg) => /^[0-9a-f]{2,8}$/i.test(seg));
}

/** Parse a known bot signal/hop reply; null for anything else. */
export function parseSignalReport(text: string): ParsedSignalReport | null {
  if (!text || text.length > 800) return null;
  const line = text.trim();
  if (line.includes('\n')) return null;

  let m = MESHMONITOR_HOPS.exec(line);
  if (m) {
    const hops = Number.parseInt(m[1], 10);
    return { source: 'meshMonitor', hops, direct: hops === 0 };
  }
  m = MESHMONITOR_DIRECT.exec(line);
  if (m) return { source: 'meshMonitor', direct: true, hops: 0, snr: num(m[1]), rssi: num(m[2]) };

  m = FW_TEST.exec(line);
  if (m) {
    const hops = Number.parseInt(m[1], 10);
    return { source: 'firmwareBot', hops, direct: hops === 0, snr: num(m[2]) };
  }
  m = FW_PATH_HOPS.exec(line);
  if (m && isFirmwarePath(m[3])) {
    return {
      source: 'firmwareBot',
      hops: Number.parseInt(m[1], 10),
      snr: num(m[2]),
      path: m[3].trim(),
    };
  }
  m = FW_PATH_DIRECT.exec(line);
  if (m) return { source: 'firmwareBot', hops: 0, direct: true, snr: num(m[1]) };
  m = FW_SIG.exec(line);
  if (m) return { source: 'firmwareBot', snr: num(m[1]), rssi: num(m[2]), noise: num(m[3]) };

  m = AG_TEST.exec(line);
  if (m) {
    const direct = m[1].toLowerCase() === 'direct';
    return {
      source: 'meshcoreBot',
      direct,
      hops: direct ? 0 : Number.parseInt(m[3], 10),
      path: direct ? undefined : m[2],
      snr: num(m[4]),
      rssi: num(m[5]),
    };
  }
  return null;
}

export type SignalQuality = 'good' | 'fair' | 'poor';

/** LoRa SNR bucket for chip coloring (SF-agnostic, coarse). */
export function signalQualityFromSnr(snr: number): SignalQuality {
  if (snr >= 5) return 'good';
  if (snr >= -5) return 'fair';
  return 'poor';
}
