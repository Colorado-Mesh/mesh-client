/**
 * Structured replies from Colorado-Mesh meshcore-bot-firmware (status, air, neighbors, trace,
 * lora, version, channels, help). Test/path/sig replies live in `signalReportParse.ts`.
 * Every bot reply may carry a `[1a2b] ` request token used for inter-bot duplicate suppression.
 */

import { parseSignalReport } from './signalReportParse';

export interface FirmwareBotNeighbor {
  name: string;
  rssi: number;
  snr: number;
  /** Firmware age string, e.g. `3m`, `2h`, `1d`. */
  ago: string;
}

export interface FirmwareBotTraceHop {
  hash: string;
  snr: number;
}

export type ParsedFirmwareBotReply =
  | {
      kind: 'status';
      name: string;
      uptime: string;
      batteryMv?: number;
      batteryPercent?: number;
      storageUsedKb: number;
      storageTotalKb: number;
      seen: number;
      sent: number;
      fail: number;
    }
  | {
      kind: 'air';
      txSeconds: number;
      rxSeconds: number;
      rxFlood: number;
      rxDirect: number;
      txFlood: number;
      txDirect: number;
    }
  | { kind: 'neighbors'; neighbors: FirmwareBotNeighbor[] }
  | { kind: 'trace'; state: 'result'; tag: string; tailSnr: number; hops: FirmwareBotTraceHop[] }
  | { kind: 'trace'; state: 'directZeroHop'; tag: string; tailSnr: number }
  | { kind: 'trace'; state: 'directLink'; snr: number }
  | { kind: 'trace'; state: 'timeout'; hops: number }
  | { kind: 'trace'; state: 'sent'; hops: number }
  | {
      kind: 'lora';
      freqMhz: number;
      sf: number;
      bwKhz: number;
      cr: number;
      txPowerDbm: number;
    }
  | { kind: 'version'; version: string; built: string }
  | { kind: 'channels'; bot: string; testing: string; emergency: string; publicChannel: string }
  | { kind: 'help'; diag: boolean; commands: string[] };

const MAX_REPLY_LEN = 800;

const NUM = String.raw`-?\d{1,3}\.\d{2}`;
const INT = String.raw`\d{1,10}`;
const NICK = String.raw`(?: @\[[^\]\n]{1,64}\])?`;
const TAG = String.raw`([0-9a-f]{8})`;

const TOKEN_PREFIX = /^\[([0-9a-f]{4})\] /i;

/* eslint-disable security/detect-non-literal-regexp -- composed from fixed literal fragments */
const STATUS = new RegExp(
  String.raw`^([^|\n]{1,64}) \| up (\d{1,5}d \d{1,2}h \d{1,2}m)(?: \| batt (\d{1,5})mV (\d{1,3})%)? \| storage (${INT})/(${INT})KB \| seen (${INT}) sent (${INT}) fail (${INT})$`,
);
const AIR = new RegExp(
  String.raw`^Air: tx (${INT})s rx (${INT})s \| rx flood (${INT}) direct (${INT}) \| tx flood (${INT}) direct (${INT})$`,
);
const NEIGHBORS = new RegExp(String.raw`^Neighbors${NICK}: (.{1,700})$`);
const NEIGHBOR_ENTRY = new RegExp(String.raw`^(.{1,32}?) (-?\d{1,3})dBm (${NUM}) (\d{1,4}[mhd])$`);
const TRACE_RESULT = new RegExp(
  String.raw`^Trace${NICK} ${TAG} (\d{1,2})h tail (${NUM}) \| ([0-9a-f@.\->\s]{4,600})$`,
  'i',
);
const TRACE_HOP = new RegExp(String.raw`^([0-9a-f]{2,8})@(${NUM})$`, 'i');
const TRACE_ZERO_HOP = new RegExp(
  String.raw`^Trace${NICK} ${TAG} direct zero-hop tail (${NUM})$`,
  'i',
);
const TRACE_DIRECT_LINK = new RegExp(
  String.raw`^Trace${NICK} direct link, SNR (${NUM}) \(no repeaters to trace\)$`,
);
const TRACE_TIMEOUT = new RegExp(
  String.raw`^Trace${NICK}(?: [0-9a-f]{8})? timed out(?::|,) no reply on (?:direct zero-hop|(\d{1,2})-hop) route$`,
  'i',
);
const TRACE_SENT = /^Trace sent on (?:direct zero-hop|(\d{1,2})-hop) route$/;
const LORA = new RegExp(
  String.raw`^LoRa${NICK} (\d{1,4}\.\d{3})MHz SF(\d{1,2}) BW(\d{1,3}\.\d{1,3})kHz CR(\d) ([+-]\d{1,2})dBm$`,
);
const VERSION = /^Firmware (\S{1,40}) built (.{1,40})$/;
const CHANNELS =
  /^Channels: bot (\S{1,32}) \| testing (\S{1,32}) \| emergency (\S{1,32}) \| public (\S{1,32}) \(\d{1,3} total\)$/;
const HELP = /^(Commands|Diag): ([a-z0-9 ]{1,400}?)(?: \| cmd diag)?(?: \| help <command>)?$/;
const HELP_COMMAND = /^[a-z0-9]{1,16}$/;
/* eslint-enable security/detect-non-literal-regexp */

function int(value: string | undefined): number {
  return value == null ? 0 : Number.parseInt(value, 10);
}

function float(value: string): number {
  return Number.parseFloat(value);
}

/** Split off the optional `[1a2b] ` request token the bot prepends to every reply. */
export function stripFirmwareBotRequestToken(text: string): { token?: string; body: string } {
  const m = TOKEN_PREFIX.exec(text);
  if (!m) return { body: text };
  return { token: m[1].toLowerCase(), body: text.slice(m[0].length) };
}

function parseNeighbors(list: string): FirmwareBotNeighbor[] | null {
  if (list === 'none heard recently') return [];
  const neighbors: FirmwareBotNeighbor[] = [];
  for (const raw of list.split(', ')) {
    const m = NEIGHBOR_ENTRY.exec(raw);
    if (!m) return null;
    neighbors.push({ name: m[1], rssi: int(m[2]), snr: float(m[3]), ago: m[4] });
  }
  return neighbors;
}

function parseTraceHops(path: string): FirmwareBotTraceHop[] | null {
  const hops: FirmwareBotTraceHop[] = [];
  for (const raw of path.split('->')) {
    const m = TRACE_HOP.exec(raw.trim());
    if (!m) return null;
    hops.push({ hash: m[1].toLowerCase(), snr: float(m[2]) });
  }
  return hops;
}

/** Parse a structured firmware-bot reply; null for anything else (including test/path/sig). */
export function parseFirmwareBotReply(text: string): ParsedFirmwareBotReply | null {
  if (!text || text.length > MAX_REPLY_LEN) return null;
  const trimmed = text.trim();
  if (trimmed.includes('\n')) return null;
  const line = stripFirmwareBotRequestToken(trimmed).body;

  let m = AIR.exec(line);
  if (m) {
    return {
      kind: 'air',
      txSeconds: int(m[1]),
      rxSeconds: int(m[2]),
      rxFlood: int(m[3]),
      rxDirect: int(m[4]),
      txFlood: int(m[5]),
      txDirect: int(m[6]),
    };
  }
  m = NEIGHBORS.exec(line);
  if (m) {
    const neighbors = parseNeighbors(m[1]);
    return neighbors ? { kind: 'neighbors', neighbors } : null;
  }
  m = TRACE_RESULT.exec(line);
  if (m) {
    const hops = parseTraceHops(m[4]);
    if (hops?.length === int(m[2])) {
      return {
        kind: 'trace',
        state: 'result',
        tag: m[1].toLowerCase(),
        tailSnr: float(m[3]),
        hops,
      };
    }
    return null;
  }
  m = TRACE_ZERO_HOP.exec(line);
  if (m) {
    return { kind: 'trace', state: 'directZeroHop', tag: m[1].toLowerCase(), tailSnr: float(m[2]) };
  }
  m = TRACE_DIRECT_LINK.exec(line);
  if (m) return { kind: 'trace', state: 'directLink', snr: float(m[1]) };
  m = TRACE_TIMEOUT.exec(line);
  if (m) return { kind: 'trace', state: 'timeout', hops: int(m[1]) };
  m = TRACE_SENT.exec(line);
  if (m) return { kind: 'trace', state: 'sent', hops: int(m[1]) };
  m = LORA.exec(line);
  if (m) {
    return {
      kind: 'lora',
      freqMhz: float(m[1]),
      sf: int(m[2]),
      bwKhz: float(m[3]),
      cr: int(m[4]),
      txPowerDbm: int(m[5]),
    };
  }
  m = VERSION.exec(line);
  if (m) return { kind: 'version', version: m[1], built: m[2] };
  m = CHANNELS.exec(line);
  if (m) {
    return { kind: 'channels', bot: m[1], testing: m[2], emergency: m[3], publicChannel: m[4] };
  }
  m = HELP.exec(line);
  if (m) {
    const commands = m[2].split(' ');
    if (!commands.every((cmd) => HELP_COMMAND.test(cmd))) return null;
    return { kind: 'help', diag: m[1] === 'Diag', commands };
  }
  m = STATUS.exec(line);
  if (m) {
    return {
      kind: 'status',
      name: m[1],
      uptime: m[2],
      ...(m[3] ? { batteryMv: int(m[3]), batteryPercent: int(m[4]) } : {}),
      storageUsedKb: int(m[5]),
      storageTotalKb: int(m[6]),
      seen: int(m[7]),
      sent: int(m[8]),
      fail: int(m[9]),
    };
  }
  return null;
}

/** True for text shaped like a Colorado-Mesh firmware-bot reply (structured or signal report). */
export function isFirmwareBotReplyText(text: string): boolean {
  if (parseFirmwareBotReply(text)) return true;
  return parseSignalReport(text)?.source === 'firmwareBot';
}

/** True for text shaped like any known bot reply (firmware bot, MeshMonitor, meshcore-bot). */
export function isBotReplyText(text: string): boolean {
  return parseFirmwareBotReply(text) != null || parseSignalReport(text) != null;
}
