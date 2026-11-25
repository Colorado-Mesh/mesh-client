/**
 * MeshCom KISS frame dispatch (0x00 / 0x10 / 0x20 / 0xF0), SrcInfo/RxMeta latch,
 * TX message frame builder, and info-field (`!` / `:`) parse.
 */

import { MESHCOM_MAX_TEXT_LEN } from '@/shared/meshcomConstants';

import { KissSlipDeframer, kissSlipEncode } from './kissSlip';
import { buildAx25UiFrame, formatAprsAddressee, parseAx25UiFrame } from './meshcomAx25';
import { normalizeMeshcomCallsign } from './meshcomCallsign';

export const MESHCOM_KISS_TYPE_DATA = 0x00;
export const MESHCOM_KISS_TYPE_RX_META = 0x10;
export const MESHCOM_KISS_TYPE_SRC_INFO = 0x20;
export const MESHCOM_KISS_TYPE_TX_RESULT = 0xf0;

export interface MeshcomKissRxMeta {
  snr: number;
  rssi: number;
  /** True when snr=0 and rssi=99 (gateway/server relay, not RF). */
  gatewayRelay: boolean;
}

export interface MeshcomKissTxResult {
  status: number;
  msgId?: number;
}

export interface MeshcomKissDataFrame {
  dest: string;
  src: string;
  digis: string[];
  info: string;
  meta?: MeshcomKissRxMeta;
}

export type MeshcomKissEvent =
  | { type: 'data'; frame: MeshcomKissDataFrame }
  | { type: 'tx_result'; result: MeshcomKissTxResult };

export type MeshcomInfoParse =
  | {
      kind: 'message';
      addressee: string;
      text: string;
      /** Present when text is `ackNN` / `rejNN`. */
      ackNumber?: string;
    }
  | {
      kind: 'position';
      latitude: number;
      longitude: number;
      comment: string;
      batteryPercent?: number;
      altitudeFt?: number;
    }
  | { kind: 'unknown'; raw: string };

function signedInt8(b: number): number {
  return b > 127 ? b - 256 : b;
}

function signedInt16Le(lo: number, hi: number): number {
  const u = (hi << 8) | lo;
  return u > 0x7fff ? u - 0x10000 : u;
}

function decodeLatin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) {
    s += String.fromCharCode(b);
  }
  return s;
}

/** Parse MeshCom/APRS info field (`!` position or `:ADDRESSEE :text`). */
export function parseMeshcomInfoField(info: string): MeshcomInfoParse {
  if (info.startsWith(':')) {
    // :ADDRESSEE :text — addressee is exactly 9 chars then ':'
    if (info.length < 11 || info[10] !== ':') {
      return { kind: 'unknown', raw: info };
    }
    const addressee = info.slice(1, 10).trim().toUpperCase();
    // Bound before emit — DB also rejects >4 KiB, but UI insert happens first.
    const text = info.slice(11, 11 + MESHCOM_MAX_TEXT_LEN);
    const ackMatch = /^(ack|rej)(\d{1,5})$/i.exec(text.trim());
    if (ackMatch) {
      return {
        kind: 'message',
        addressee,
        text,
        ackNumber: ackMatch[2],
      };
    }
    return { kind: 'message', addressee, text };
  }

  if (info.startsWith('!') || info.startsWith('=')) {
    const pos = parseAprsUncompressedPosition(info.slice(1));
    if (!pos) return { kind: 'unknown', raw: info };
    const batteryMatch = /\/B=(\d{1,3})/.exec(pos.comment);
    const altMatch = /\/A=(\d{1,6})/.exec(pos.comment);
    return {
      kind: 'position',
      latitude: pos.latitude,
      longitude: pos.longitude,
      comment: pos.comment,
      batteryPercent: batteryMatch ? Number.parseInt(batteryMatch[1], 10) : undefined,
      altitudeFt: altMatch ? Number.parseInt(altMatch[1], 10) : undefined,
    };
  }

  return { kind: 'unknown', raw: info };
}

/** APRS uncompressed lat/lon: `DDMM.mmN/DDDMM.mmE` (+ optional symbol/comment). */
export function parseAprsUncompressedPosition(
  body: string,
): { latitude: number; longitude: number; comment: string } | null {
  // 4903.50N/07201.75W-comment
  const match = /^(\d{2})(\d{2}\.\d{2})([NS])([/\\])(\d{3})(\d{2}\.\d{2})([EW])(.)(.*)$/i.exec(
    body,
  );
  if (!match) return null;
  const latDeg = Number.parseInt(match[1], 10);
  const latMin = Number.parseFloat(match[2]);
  const lonDeg = Number.parseInt(match[5], 10);
  const lonMin = Number.parseFloat(match[6]);
  if (![latDeg, latMin, lonDeg, lonMin].every(Number.isFinite)) return null;
  let latitude = latDeg + latMin / 60;
  let longitude = lonDeg + lonMin / 60;
  if (match[3].toUpperCase() === 'S') latitude = -latitude;
  if (match[7].toUpperCase() === 'W') longitude = -longitude;
  return {
    latitude,
    longitude,
    comment: match[9],
  };
}

/** Build a MeshCom APRS message info field (`:ADDRESSEE :text{nn`). */
export function buildMeshcomMessageInfo(dst: string, text: string, msgNumber: number): string {
  const addressee = formatAprsAddressee(dst);
  const nn = String(Math.max(0, Math.min(99999, msgNumber))).padStart(2, '0');
  return `:${addressee}:${text}{${nn}`;
}

/** Build a full KISS-wrapped TX data frame for a text message. */
export function buildMeshcomKissTxMessage(opts: {
  operatorCallsign: string;
  destination: string;
  text: string;
  msgNumber: number;
  destTocall?: string;
}): Uint8Array {
  const info = buildMeshcomMessageInfo(opts.destination, opts.text, opts.msgNumber);
  const ax25 = buildAx25UiFrame({
    dest: opts.destTocall ?? 'APRS',
    src: opts.operatorCallsign,
    info,
  });
  const payload = new Uint8Array(1 + ax25.length);
  payload[0] = MESHCOM_KISS_TYPE_DATA;
  payload.set(ax25, 1);
  return kissSlipEncode(payload);
}

/**
 * Stateful KISS RX session: deframe TCP bytes, latch SrcInfo/RxMeta, emit data/tx_result.
 */
export class MeshcomKissSession {
  private readonly deframer = new KissSlipDeframer();
  private pendingSrcInfo: string | null = null;
  private pendingData: MeshcomKissDataFrame | null = null;

  pushBytes(chunk: Uint8Array | number[]): MeshcomKissEvent[] {
    const events: MeshcomKissEvent[] = [];
    for (const frame of this.deframer.push(chunk)) {
      events.push(...this.dispatchFrame(frame));
    }
    return events;
  }

  /** Flush any data waiting for RxMeta (e.g. on disconnect). */
  // fallow-ignore-next-line unused-class-member
  flush(): MeshcomKissEvent[] {
    if (!this.pendingData) return [];
    const frame = this.pendingData;
    this.pendingData = null;
    return [{ type: 'data', frame }];
  }

  // fallow-ignore-next-line unused-class-member
  reset(): void {
    this.deframer.reset();
    this.pendingSrcInfo = null;
    this.pendingData = null;
  }

  private dispatchFrame(frame: Uint8Array): MeshcomKissEvent[] {
    if (frame.length < 1) return [];
    const type = frame[0];
    const body = frame.subarray(1);

    if (type === MESHCOM_KISS_TYPE_SRC_INFO) {
      this.pendingSrcInfo = normalizeMeshcomCallsign(decodeLatin1(body));
      return [];
    }

    if (type === MESHCOM_KISS_TYPE_RX_META) {
      if (body.length < 3) return [];
      const snr = signedInt8(body[0]);
      const rssi = signedInt16Le(body[1], body[2]);
      const meta: MeshcomKissRxMeta = {
        snr,
        rssi,
        gatewayRelay: snr === 0 && rssi === 99,
      };
      if (this.pendingData) {
        const data = this.pendingData;
        this.pendingData = null;
        return [{ type: 'data', frame: { ...data, meta } }];
      }
      return [];
    }

    if (type === MESHCOM_KISS_TYPE_TX_RESULT) {
      const flushed = this.flushPendingData();
      if (body.length < 1) return flushed;
      const status = body[0];
      const result: MeshcomKissTxResult = { status };
      if (status === 0x01 && body.length >= 5) {
        result.msgId = body[1] | (body[2] << 8) | (body[3] << 16) | (body[4] << 24);
      }
      return [...flushed, { type: 'tx_result', result }];
    }

    if (type === MESHCOM_KISS_TYPE_DATA) {
      const flushed = this.flushPendingData();
      const parsed = parseAx25UiFrame(body);
      if (!parsed) return flushed;
      const srcOverride = this.pendingSrcInfo;
      this.pendingSrcInfo = null;
      const data: MeshcomKissDataFrame = {
        dest: parsed.dest.callsign,
        src: srcOverride || parsed.src.callsign,
        digis: parsed.digis.map((d) => d.callsign),
        info: decodeLatin1(parsed.info),
      };
      this.pendingData = data;
      return flushed;
    }

    // Unknown type — flush pending data so it is not stuck.
    return this.flushPendingData();
  }

  private flushPendingData(): MeshcomKissEvent[] {
    if (!this.pendingData) return [];
    const frame = this.pendingData;
    this.pendingData = null;
    return [{ type: 'data', frame }];
  }
}
