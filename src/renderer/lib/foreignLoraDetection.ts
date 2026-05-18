import { parseMeshCoreRfPacket } from '../../shared/meshcoreRfPacketParse';
import { meshcoreRawPacketResolveFromParsed } from './meshcoreRawPacketSender';

export type PacketClass = 'meshcore' | 'meshtastic' | 'unknown-lora';

/**
 * Fingerprint a raw LoRa payload into a packet class.
 * MeshCore is determined by successful `parseMeshCoreRfPacket` (structural validation) before
 * Meshtastic byte heuristics, so frames that look like Meshtastic dest/src but are valid MeshCore
 * on-air layouts are labeled `meshcore`.
 */
export function classifyPayload(raw: Uint8Array): PacketClass {
  if (raw.length === 0) return 'unknown-lora';

  if (parseMeshCoreRfPacket(raw).ok) {
    return 'meshcore';
  }

  // Legacy marker for truncated captures / minimal buffers that do not survive full path decode.
  if (raw[0] === 0x3c) {
    return 'meshcore';
  }

  if (raw.length >= 8) {
    const destId = (raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24)) >>> 0;
    const senderId = (raw[4] | (raw[5] << 8) | (raw[6] << 16) | (raw[7] << 24)) >>> 0;
    const BROADCAST = 0xffffffff;
    if (destId !== 0 && destId !== BROADCAST && senderId !== 0 && senderId !== BROADCAST) {
      if (raw.length >= 16) {
        // Full 16-byte Meshtastic header available: validate the flags byte (byte 12) to reduce
        // false positives from MeshCore encrypted packets whose first 8 bytes resemble node IDs.
        // hop_limit (bits [2:0]) must be <= hop_start (bits [7:5]); hop_start=0 is valid for
        // direct-only devices (hop_limit=0).
        const flags = raw[12];
        const hopLimit = flags & 0x07;
        const hopStart = (flags >> 5) & 0x07;
        if (hopLimit <= hopStart) return 'meshtastic';
      } else {
        return 'meshtastic';
      }
    }
  }

  return 'unknown-lora';
}

/**
 * Check if a Meshtastic device log message contains the MeshCore 0x3c frame-start
 * pattern in a dropped/CRC/decode-failure context. Accepts common firmware wordings
 * (e.g. "preamble", "decode failed") so MeshCore traffic is recognized when the
 * device logs the failure and includes the first byte or '<' (0x3c).
 */
/** Log messages indicating receive/decode failure (packet dropped, CRC, preamble, etc.). */
const FAILURE_CONTEXT_REGEX =
  /packet.?dropped|crc.?err|crc.?fail|crc.?bad|bad.?crc|decode.?fail|decode.?error|corrupt.?packet|bad.?packet|invalid.?packet|preamble|rx.?error|lora.?err/i;

/** True when a device log message indicates a packet decode failure. */
export function isDecodeFail(message: string): boolean {
  return FAILURE_CONTEXT_REGEX.test(message);
}

export function containsMeshCorePattern(message: string): boolean {
  if (!FAILURE_CONTEXT_REGEX.test(message)) return false;
  return (
    /\b3c\s+[0-9a-f]{1,2}\s+[0-9a-f]{1,2}/i.test(message) ||
    /\b3c[0-9a-f]{4}/i.test(message) ||
    /\b0x3c\b/i.test(message) ||
    /0x3c\s*0x[0-9a-f]{2}\s*0x[0-9a-f]{2}/i.test(message) ||
    (message.includes('<') && FAILURE_CONTEXT_REGEX.test(message))
  );
}

export type ForeignLoraLogMatch =
  | { packetClass: 'meshcore'; rssi?: number; snr?: number; senderId?: number }
  | { packetClass: 'unknown-lora'; rssi?: number; snr?: number };

function parseHexByteTokens(fragment: string): Uint8Array | null {
  const tokens: string[] = [];
  for (const part of fragment.trim().split(/\s+/)) {
    const t = part.replace(/^0x/i, '');
    if (/^[0-9a-f]{2}$/i.test(t)) tokens.push(t);
  }
  if (tokens.length < 8) return null;
  const out = new Uint8Array(tokens.length);
  for (let i = 0; i < tokens.length; i++) {
    out[i] = parseInt(tokens[i], 16);
  }
  return out;
}

/** Pull a raw byte buffer from common Meshtastic firmware log hex dumps (often after 0x3c). */
export function extractHexPayloadFromMeshtasticLog(message: string): Uint8Array | null {
  const dataPayloadRe =
    /(?:payload|data|bytes?|hex)[=:\s]+(.+?)(?:\s+snr=|\s+rssi=|\s+SNR=|\s+RSSI=|$)/i;
  const dataMatch = dataPayloadRe.exec(message);
  if (dataMatch?.[1]) {
    const bytes = parseHexByteTokens(dataMatch[1]);
    if (bytes) return bytes;
  }

  const patterns = [
    /\b3c\s+((?:[0-9a-f]{2}\s+){7,}[0-9a-f]{2})/i,
    /\b0x3c\s*((?:0x[0-9a-f]{2}\s*){8,})/i,
  ];
  for (const re of patterns) {
    const m = message.match(re);
    if (!m?.[1]) continue;
    let fragment = m[1];
    if (/^0x/i.test(fragment.trim())) {
      fragment = fragment.replace(/0x/gi, '').replace(/\s+/g, ' ');
    }
    const bytes = parseHexByteTokens(fragment.startsWith('3c') ? fragment : `3c ${fragment}`);
    if (bytes) return bytes;
  }
  return null;
}

/** When the log includes enough hex, resolve MeshCore sender from ADVERT / ANON_REQ layout. */
export function extractMeshCoreSenderIdFromMeshtasticLog(message: string): number | null {
  const raw = extractHexPayloadFromMeshtasticLog(message);
  if (!raw) return null;
  const parsed = parseMeshCoreRfPacket(raw);
  if (parsed.ok) {
    return meshcoreRawPacketResolveFromParsed(parsed, new Map());
  }
  return null;
}

/**
 * Classify a Meshtastic device log line for Foreign LoRa (LogRecord payload or
 * iMeshDevice console line forwarded via log.onLine).
 */
export function matchForeignLoraFromMeshtasticLog(message: string): ForeignLoraLogMatch | null {
  const { rssi, snr } = extractRssiSnr(message);
  if (containsMeshCorePattern(message)) {
    const senderId = extractMeshCoreSenderIdFromMeshtasticLog(message) ?? undefined;
    return { packetClass: 'meshcore', rssi, snr, senderId };
  }
  if (isDecodeFail(message) && (rssi !== undefined || snr !== undefined)) {
    return { packetClass: 'unknown-lora', rssi, snr };
  }
  return null;
}

/** Quick filter before parsing full log lines (console stream is high volume). */
export function isForeignLoraLogCandidate(message: string): boolean {
  return isDecodeFail(message) || containsMeshCorePattern(message);
}

/** Extract RSSI and SNR from a Meshtastic device log message. */
export function extractRssiSnr(message: string): { rssi?: number; snr?: number } {
  const rssiMatch = /rssi[=:\s]+(-?\d+)/i.exec(message);
  const snrMatch = /snr[=:\s]+(-?\d+(?:\.\d+)?)/i.exec(message);
  return {
    rssi: rssiMatch ? parseInt(rssiMatch[1], 10) : undefined,
    snr: snrMatch ? parseFloat(snrMatch[1]) : undefined,
  };
}

/** Classify proximity from RSSI (primary) or SNR (fallback). */
export function classifyProximity(
  rssi?: number,
  snr?: number,
): 'very-close' | 'nearby' | 'distant' | 'unknown' {
  if (rssi !== undefined) {
    if (rssi > -80) return 'very-close';
    if (rssi >= -95) return 'nearby';
    return 'distant';
  }
  if (snr !== undefined) {
    if (snr > 8) return 'very-close';
    if (snr >= 2) return 'nearby';
    return 'distant';
  }
  return 'unknown';
}

/** Extract the Meshtastic sender node ID (bytes 4-7, little-endian) from a raw payload. */
export function extractMeshtasticSenderId(raw: Uint8Array): number | null {
  if (raw.length < 8) return null;
  const id = (raw[4] | (raw[5] << 8) | (raw[6] << 16) | (raw[7] << 24)) >>> 0;
  if (id === 0 || id === 0xffffffff) return null;
  return id;
}

/**
 * Raw packet log: only treat bytes 4–7 as Meshtastic `from` when the buffer did **not** parse as
 * MeshCore. If `parseMeshCoreRfPacket` succeeded, those offsets are MeshCore path/payload — not
 * Meshtastic node IDs.
 */
export function meshtasticSenderIdForRawLogFallback(
  meshcoreParseOk: boolean,
  raw: Uint8Array,
): number | null {
  if (meshcoreParseOk) return null;
  return extractMeshtasticSenderId(raw);
}

/** Rolling window packet counter for rate detection. */
export class RollingRateCounter {
  private readonly windowMs: number;
  private readonly cleanupThreshold: number;
  private timestamps: number[] = [];

  constructor(windowMs: number, cleanupThreshold = 100) {
    this.windowMs = windowMs;
    this.cleanupThreshold = cleanupThreshold;
  }

  record(): void {
    this.timestamps.push(Date.now());
    if (this.timestamps.length > this.cleanupThreshold) {
      this.cleanup();
    }
  }

  reset(): void {
    this.timestamps = [];
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    this.timestamps = this.timestamps.filter((t) => t >= cutoff);
    if (this.timestamps.length > 10_000) {
      this.timestamps = this.timestamps.slice(-10_000);
    }
  }

  /** Returns packets per minute over the rolling window. */
  getRate(): number {
    this.cleanup();
    return (this.timestamps.length / this.windowMs) * 60_000;
  }
}
