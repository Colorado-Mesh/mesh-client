import {
  MC_CMD_SEND_BINARY_REQ,
  MC_CMD_SEND_LOGIN,
  MC_CMD_SEND_STATUS_REQ,
  MC_CMD_SEND_TELEMETRY_REQ,
} from './meshcoreWireCodes';

/** Shared minimal radio connection surface for MeshCore RPC modules. */
export interface MeshcoreRadioConnection {
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
  once(event: string | number, cb: (...args: unknown[]) => void): void;
  sendToRadioFrame(data: Uint8Array): Promise<void>;
}

/** @deprecated Use MeshcoreRadioConnection */
export type MeshcoreRepeaterRpcConnection = MeshcoreRadioConnection;

export {
  MC_CMD_SEND_BINARY_REQ,
  MC_CMD_SEND_LOGIN,
  MC_CMD_SEND_STATUS_REQ,
  MC_CMD_SEND_TELEMETRY_REQ,
  MC_PUSH_BINARY_RESPONSE,
  MC_PUSH_LOGIN_FAIL,
  MC_PUSH_LOGIN_SUCCESS,
  MC_PUSH_STATUS_RESPONSE,
  MC_PUSH_TELEMETRY_RESPONSE,
  MC_RESP_ERR,
  MC_RESP_SENT,
} from './meshcoreWireCodes';

export interface MeshcoreRepeaterLoginResponse {
  reserved?: number;
  pubKeyPrefix?: Uint8Array;
  permissions?: number;
}

export interface MeshcoreRepeaterStatusPush {
  reserved?: number;
  pubKeyPrefix?: Uint8Array;
  statusData?: Uint8Array;
}

export interface MeshcoreRepeaterTelemetryPush {
  reserved?: number;
  pubKeyPrefix?: Uint8Array;
  lppSensorData?: Uint8Array;
}

/** Parsed repeater stats (matches meshcore.js getStatus resolve shape). */
export interface MeshcoreRepeaterStats {
  batt_milli_volts: number;
  curr_tx_queue_len: number;
  noise_floor: number;
  last_rssi: number;
  n_packets_recv: number;
  n_packets_sent: number;
  total_air_time_secs: number;
  total_up_time_secs: number;
  n_sent_flood: number;
  n_sent_direct: number;
  n_recv_flood: number;
  n_recv_direct: number;
  err_events: number;
  last_snr: number;
  n_direct_dups: number;
  n_flood_dups: number;
}

export function normalizePubKeyPrefix(prefix: unknown): Uint8Array | null {
  if (prefix instanceof Uint8Array && prefix.length === 6) {
    return prefix;
  }
  if (ArrayBuffer.isView(prefix) && prefix.byteLength === 6) {
    return new Uint8Array(prefix.buffer, prefix.byteOffset, 6);
  }
  if (Array.isArray(prefix) && prefix.length === 6) {
    return Uint8Array.from(prefix);
  }
  return null;
}

export function pubKeyPrefixesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== 6 || b.length !== 6) return false;
  let diff = 0;
  for (let i = 0; i < 6; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function prefixToHex(prefix: Uint8Array): string {
  return Array.from(prefix)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function unknownToError(e: unknown, fallback: string): Error {
  if (e instanceof Error) return e;
  if (e === null || e === undefined) return new Error(fallback);
  if (typeof e === 'string') return new Error(e);
  return new Error(fallback);
}

export function buildSendLoginFrame(publicKey: Uint8Array, password: string): Uint8Array {
  if (publicKey.length !== 32) {
    throw new Error('Repeater login requires a 32-byte public key');
  }
  const passwordField =
    password.length === 0 ? new Uint8Array(0) : new TextEncoder().encode(password);
  const frame = new Uint8Array(1 + 32 + passwordField.length);
  frame[0] = MC_CMD_SEND_LOGIN;
  frame.set(publicKey, 1);
  frame.set(passwordField, 33);
  return frame;
}

export function buildSendStatusReqFrame(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== 32) {
    throw new Error('Status request requires a 32-byte public key');
  }
  const frame = new Uint8Array(1 + 32);
  frame[0] = MC_CMD_SEND_STATUS_REQ;
  frame.set(publicKey, 1);
  return frame;
}

export function buildSendTelemetryReqFrame(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== 32) {
    throw new Error('Telemetry request requires a 32-byte public key');
  }
  const frame = new Uint8Array(1 + 3 + 32);
  frame[0] = MC_CMD_SEND_TELEMETRY_REQ;
  frame.set(publicKey, 4);
  return frame;
}

export function buildSendBinaryReqFrame(
  publicKey: Uint8Array,
  requestCodeAndParams: Uint8Array,
): Uint8Array {
  if (publicKey.length !== 32) {
    throw new Error('Binary request requires a 32-byte public key');
  }
  const frame = new Uint8Array(1 + 32 + requestCodeAndParams.length);
  frame[0] = MC_CMD_SEND_BINARY_REQ;
  frame.set(publicKey, 1);
  frame.set(requestCodeAndParams, 33);
  return frame;
}

/** Parse repeater stats from StatusResponse push payload (matches meshcore.js). */
export function parseRepeaterStatsFromStatusData(statusData: Uint8Array): MeshcoreRepeaterStats {
  const view = new DataView(statusData.buffer, statusData.byteOffset, statusData.byteLength);
  let o = 0;
  const readU16 = (): number => {
    const v = view.getUint16(o, true);
    o += 2;
    return v;
  };
  const readI16 = (): number => {
    const v = view.getInt16(o, true);
    o += 2;
    return v;
  };
  const readU32 = (): number => {
    const v = view.getUint32(o, true);
    o += 4;
    return v;
  };
  return {
    batt_milli_volts: readU16(),
    curr_tx_queue_len: readU16(),
    noise_floor: readI16(),
    last_rssi: readI16(),
    n_packets_recv: readU32(),
    n_packets_sent: readU32(),
    total_air_time_secs: readU32(),
    total_up_time_secs: readU32(),
    n_sent_flood: readU32(),
    n_sent_direct: readU32(),
    n_recv_flood: readU32(),
    n_recv_direct: readU32(),
    err_events: readU16(),
    last_snr: readI16(),
    n_direct_dups: readU16(),
    n_flood_dups: readU16(),
  };
}
