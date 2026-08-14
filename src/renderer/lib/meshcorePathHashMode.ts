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
    let settled = false;
    const cleanup = (): void => {
      conn.off(MC_RESP_OK, onOk);
      conn.off(MC_RESP_ERR, onErr);
    };
    const onOk = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onErr = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('radio rejected path hash mode'));
    };
    conn.on(MC_RESP_OK, onOk);
    conn.on(MC_RESP_ERR, onErr);
    void conn.sendToRadioFrame(buildSetPathHashModeFrame(mode)).catch((err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
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

/**
 * AppPanel auto-saves the full settings object (defaults merged in). Path hash mode and
 * Open-wire live on Radio — omit them so an App visit cannot overwrite RadioPanel writes.
 */
export function appPanelSettingsPersistPayload(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const rest = { ...settings };
  delete rest.meshcorePathHashMode;
  delete rest.meshcoreOpenWireCompatEnabled;
  return rest;
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
