import { isMeshcorePathHashMode, type MeshcorePathHashMode } from '@/shared/meshcorePathHash';

/** meshcore-dev/MeshCore companion_radio CMD_SET_PATH_HASH_MODE */
export const MC_CMD_SET_PATH_HASH_MODE = 61;

/** meshcore.js ResponseCodes */
const MC_RESP_OK = 0;
const MC_RESP_ERR = 1;

export interface MeshcorePathHashModeConnection {
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
  once(event: string | number, cb: (...args: unknown[]) => void): void;
  sendToRadioFrame(data: Uint8Array): Promise<void>;
}

export function buildSetPathHashModeFrame(mode: MeshcorePathHashMode): Uint8Array {
  if (!isMeshcorePathHashMode(mode)) {
    throw new Error(`Invalid path hash mode: ${String(mode)}`);
  }
  return Uint8Array.from([MC_CMD_SET_PATH_HASH_MODE, 0, mode]);
}

/** Apply companion global path hash mode (firmware v1.14+). */
export function setMeshcorePathHashModeOnRadio(
  conn: MeshcorePathHashModeConnection,
  mode: MeshcorePathHashMode,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOk = () => {
      conn.off(MC_RESP_OK, onOk);
      conn.off(MC_RESP_ERR, onErr);
      resolve();
    };
    const onErr = () => {
      conn.off(MC_RESP_OK, onOk);
      conn.off(MC_RESP_ERR, onErr);
      reject(new Error('radio rejected path hash mode'));
    };
    conn.once(MC_RESP_OK, onOk);
    conn.once(MC_RESP_ERR, onErr);
    void conn.sendToRadioFrame(buildSetPathHashModeFrame(mode)).catch((err: unknown) => {
      conn.off(MC_RESP_OK, onOk);
      conn.off(MC_RESP_ERR, onErr);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

export interface MeshcoreDeviceQueryPathHashFields {
  pathHashMode?: MeshcorePathHashMode;
  firmwareVersion?: string;
  manufacturerModel?: string;
  clientRepeat?: number;
}

/** Parse path_hash_mode from meshcore.js DeviceInfo (v10+ companion protocol). */
export function parsePathHashModeFromDeviceQuery(info: unknown): MeshcoreDeviceQueryPathHashFields {
  if (info == null || typeof info !== 'object') return {};
  const r = info as Record<string, unknown>;

  if (isMeshcorePathHashMode(r.pathHashMode)) {
    return {
      pathHashMode: r.pathHashMode,
      firmwareVersion: typeof r.firmwareVersion === 'string' ? r.firmwareVersion : undefined,
      manufacturerModel: typeof r.manufacturerModel === 'string' ? r.manufacturerModel : undefined,
      clientRepeat:
        typeof r.clientRepeat === 'number' && Number.isFinite(r.clientRepeat)
          ? r.clientRepeat
          : undefined,
    };
  }

  if (isMeshcorePathHashMode(r.path_hash_mode)) {
    return { pathHashMode: r.path_hash_mode };
  }

  return {
    firmwareVersion: typeof r.firmwareVersion === 'string' ? r.firmwareVersion : undefined,
    manufacturerModel: typeof r.manufacturerModel === 'string' ? r.manufacturerModel : undefined,
  };
}
