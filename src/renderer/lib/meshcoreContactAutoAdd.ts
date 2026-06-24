/**
 * MeshCore companion contact auto-add (NodePrefs.autoadd_config, autoadd_max_hops).
 * @see meshcore-dev/MeshCore examples/companion_radio/MyMesh.cpp (CMD_SET_AUTOADD_CONFIG, CMD_GET_AUTOADD_CONFIG)
 */

export const MESHCORE_CMD_SET_AUTOADD_CONFIG = 58;
export const MESHCORE_CMD_GET_AUTOADD_CONFIG = 59;
export const MESHCORE_RESP_CODE_AUTOADD_CONFIG = 25;
/** meshcore.js `ResponseCodes.Err` — also the first byte of an Err radio frame */
export const MESHCORE_RESP_CODE_ERR = 1;
/** meshcore.js `ErrorCodes.UnsupportedCmd` */
export const MESHCORE_ERR_UNSUPPORTED_CMD = 1;

export const MESHCORE_AUTOADD_GET_TIMEOUT_MS = 8_000;

/** Bit 0: overwrite oldest non-favourite when contacts storage is full */
export const MESHCORE_AUTO_ADD_OVERWRITE_OLDEST = 1 << 0;
/** Bits 1–4: auto-add these advert types when manual_add_contacts LSB = 1 */
export const MESHCORE_AUTO_ADD_CHAT = 1 << 1;
export const MESHCORE_AUTO_ADD_REPEATER = 1 << 2;
export const MESHCORE_AUTO_ADD_ROOM_SERVER = 1 << 3;
export const MESHCORE_AUTO_ADD_SENSOR = 1 << 4;

export const MESHCORE_AUTO_ADD_TYPE_MASK =
  MESHCORE_AUTO_ADD_CHAT |
  MESHCORE_AUTO_ADD_REPEATER |
  MESHCORE_AUTO_ADD_ROOM_SERVER |
  MESHCORE_AUTO_ADD_SENSOR;

/** Firmware clamps hops to 64 on SET */
export const MESHCORE_AUTOADD_MAX_HOPS_WIRE_MAX = 64;

export function buildSetAutoaddConfigFrame(configByte: number, maxHops: number): Uint8Array {
  const hops = Math.max(0, Math.min(maxHops, MESHCORE_AUTOADD_MAX_HOPS_WIRE_MAX));
  return new Uint8Array([MESHCORE_CMD_SET_AUTOADD_CONFIG, configByte & 0xff, hops & 0xff]);
}

export function buildGetAutoaddConfigFrame(): Uint8Array {
  return new Uint8Array([MESHCORE_CMD_GET_AUTOADD_CONFIG]);
}

export interface MeshcoreAutoaddWireState {
  autoaddConfig: number;
  autoaddMaxHops: number;
}

/** Normalize companion `rx` payloads (meshcore.js emits raw frames on `"rx"`). */
export function meshcoreCoerceRadioRxFrame(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array && data.length > 0) return data;
  if (ArrayBuffer.isView(data) && data.byteLength > 0) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

export function parseAutoaddConfigResponse(frame: Uint8Array): MeshcoreAutoaddWireState | null {
  if (frame.length < 3) return null;
  if (frame[0] !== MESHCORE_RESP_CODE_AUTOADD_CONFIG) return null;
  return {
    autoaddConfig: frame[1] & 0xff,
    autoaddMaxHops: frame[2] & 0xff,
  };
}

/** True when firmware rejects CMD_GET_AUTOADD_CONFIG (older companion builds). */
export function isMeshcoreAutoaddGetUnsupportedErrFrame(frame: Uint8Array): boolean {
  return (
    frame.length >= 2 &&
    frame[0] === MESHCORE_RESP_CODE_ERR &&
    frame[1] === MESHCORE_ERR_UNSUPPORTED_CMD
  );
}

export type MeshcoreAutoaddFetchOutcome =
  | { kind: 'ok'; state: MeshcoreAutoaddWireState }
  | { kind: 'unsupported' }
  | { kind: 'timeout' };

export interface MeshcoreAutoaddQueryConn {
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
  sendToRadioFrame(data: Uint8Array): Promise<void>;
}

/**
 * Query companion auto-add prefs over the radio link. Resolves with `unsupported` or
 * `timeout` when the device lacks CMD_GET_AUTOADD_CONFIG (non-fatal on connect).
 */
export function fetchMeshcoreAutoaddConfigFromConn(
  conn: MeshcoreAutoaddQueryConn,
  timeoutMs = MESHCORE_AUTOADD_GET_TIMEOUT_MS,
): Promise<MeshcoreAutoaddFetchOutcome> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (outcome: MeshcoreAutoaddFetchOutcome) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(outcome);
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const cleanup = () => {
      window.clearTimeout(timer);
      conn.off('rx', onRx);
      conn.off(MESHCORE_RESP_CODE_ERR, onErrEvent);
    };

    const onRx = (data: unknown) => {
      const frame = meshcoreCoerceRadioRxFrame(data);
      if (!frame) return;
      const parsed = parseAutoaddConfigResponse(frame);
      if (parsed) {
        finish({ kind: 'ok', state: parsed });
        return;
      }
      if (isMeshcoreAutoaddGetUnsupportedErrFrame(frame)) {
        finish({ kind: 'unsupported' });
      }
    };

    const onErrEvent = (data: unknown) => {
      const errCode =
        data != null && typeof data === 'object' && 'errCode' in data
          ? (data as { errCode?: number | null }).errCode
          : undefined;
      if (errCode === MESHCORE_ERR_UNSUPPORTED_CMD) {
        finish({ kind: 'unsupported' });
      }
    };

    const timer = window.setTimeout(() => {
      finish({ kind: 'timeout' });
    }, timeoutMs);

    conn.on('rx', onRx);
    conn.on(MESHCORE_RESP_CODE_ERR, onErrEvent);
    void conn.sendToRadioFrame(buildGetAutoaddConfigFrame()).catch(fail);
  });
}

export function mergeAutoaddConfigByte(options: {
  overwriteOldest: boolean;
  chat: boolean;
  repeater: boolean;
  roomServer: boolean;
  sensor: boolean;
}): number {
  let b = 0;
  if (options.overwriteOldest) b |= MESHCORE_AUTO_ADD_OVERWRITE_OLDEST;
  if (options.chat) b |= MESHCORE_AUTO_ADD_CHAT;
  if (options.repeater) b |= MESHCORE_AUTO_ADD_REPEATER;
  if (options.roomServer) b |= MESHCORE_AUTO_ADD_ROOM_SERVER;
  if (options.sensor) b |= MESHCORE_AUTO_ADD_SENSOR;
  return b & 0xff;
}

export function splitAutoaddConfigByte(configByte: number): {
  overwriteOldest: boolean;
  chat: boolean;
  repeater: boolean;
  roomServer: boolean;
  sensor: boolean;
} {
  const b = configByte & 0xff;
  return {
    overwriteOldest: (b & MESHCORE_AUTO_ADD_OVERWRITE_OLDEST) !== 0,
    chat: (b & MESHCORE_AUTO_ADD_CHAT) !== 0,
    repeater: (b & MESHCORE_AUTO_ADD_REPEATER) !== 0,
    roomServer: (b & MESHCORE_AUTO_ADD_ROOM_SERVER) !== 0,
    sensor: (b & MESHCORE_AUTO_ADD_SENSOR) !== 0,
  };
}
