import { getAppSettingsRaw, mergeAppSetting } from './appSettingsStorage';
import { errLikeToLogString } from './errLikeToLogString';
import { parseStoredJson } from './parseStoredJson';

/** Per-node SQLite/localStorage key: meshtasticRemoteAdminKey:<nodeNum> */
export const MESHTASTIC_REMOTE_ADMIN_KEY_SETTING_PREFIX = 'meshtasticRemoteAdminKey:';

/** Legacy JSON blob key (read for migration only). */
export const MESHTASTIC_REMOTE_ADMIN_KEY_BY_NODE_SETTING = 'meshtasticRemoteAdminKeyByNode';

export function meshtasticRemoteAdminKeySettingForNode(nodeNum: number): string {
  return `${MESHTASTIC_REMOTE_ADMIN_KEY_SETTING_PREFIX}${String(nodeNum >>> 0)}`;
}

function padBase64(b64: string): string {
  const padLen = (4 - (b64.length % 4)) % 4;
  return padLen === 0 ? b64 : b64 + '='.repeat(padLen);
}

function bytesToCanonicalAdminKeyBase64(bytes: Uint8Array): string {
  if (bytes.length !== 32) return '';
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Accept Meshtastic admin key paste variants:
 * - raw base64 (32 bytes)
 * - `base64:` prefix (CLI / docs)
 * - 64-char hex (common in device UIs)
 */
export function normalizeMeshtasticAdminKeyInput(raw: string): string | undefined {
  let s = raw.trim();
  if (!s) return undefined;

  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }

  const lower = s.toLowerCase();
  if (lower.startsWith('base64:')) {
    s = s.slice('base64:'.length).trim();
  }

  s = s.replace(/\s+/g, '');

  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      const byte = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
      if (!Number.isFinite(byte)) return undefined;
      bytes[i] = byte;
    }
    return bytesToCanonicalAdminKeyBase64(bytes);
  }

  try {
    const binary = atob(padBase64(s));
    if (binary.length !== 32) return undefined;
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytesToCanonicalAdminKeyBase64(bytes);
  } catch {
    // catch-no-log-ok invalid base64/hex input returns undefined for validation
    return undefined;
  }
}

/** Base64-encoded 32-byte Curve25519 public key (canonical storage form). */
export function parseMeshtasticAdminKeyBase64(b64: string): Uint8Array | undefined {
  const normalized = normalizeMeshtasticAdminKeyInput(b64);
  if (!normalized) return undefined;
  try {
    const binary = atob(normalized);
    if (binary.length !== 32) return undefined;
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    // catch-no-log-ok invalid base64 input returns undefined for validation
    return undefined;
  }
}

export function isValidMeshtasticAdminKeyBase64(b64: string): boolean {
  return normalizeMeshtasticAdminKeyInput(b64) != null;
}

function parseAdminKeyMap(raw: unknown): Record<string, string> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    const normalized = normalizeMeshtasticAdminKeyInput(value);
    if (!normalized) continue;
    out[key] = normalized;
  }
  return out;
}

function readLegacyAdminKeyMap(settings: Record<string, unknown> | null): Record<string, string> {
  const raw = settings?.[MESHTASTIC_REMOTE_ADMIN_KEY_BY_NODE_SETTING];
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      return parseAdminKeyMap(JSON.parse(raw) as unknown);
    } catch {
      // catch-no-log-ok corrupt legacy JSON blob is ignored on read
      return {};
    }
  }
  return parseAdminKeyMap(raw);
}

export function readMeshtasticRemoteAdminKeyMap(): Record<string, string> {
  const settings = parseStoredJson<Record<string, unknown>>(
    getAppSettingsRaw(),
    'meshtasticRemoteAdminKeyStorage read',
  );
  const out: Record<string, string> = { ...readLegacyAdminKeyMap(settings) };
  if (!settings) return out;
  const prefix = MESHTASTIC_REMOTE_ADMIN_KEY_SETTING_PREFIX;
  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith(prefix) || typeof value !== 'string') continue;
    const nodeId = key.slice(prefix.length);
    const normalized = normalizeMeshtasticAdminKeyInput(value);
    if (!normalized) continue;
    out[nodeId] = normalized;
  }
  return out;
}

export function getMeshtasticRemoteAdminKeyForNode(nodeNum: number): string | undefined {
  const key = String(nodeNum >>> 0);
  return readMeshtasticRemoteAdminKeyMap()[key];
}

export async function setMeshtasticRemoteAdminKeyForNode(
  nodeNum: number,
  adminKeyBase64: string | null,
): Promise<Record<string, string>> {
  const map = readMeshtasticRemoteAdminKeyMap();
  const id = String(nodeNum >>> 0);
  const settingKey = meshtasticRemoteAdminKeySettingForNode(nodeNum);

  if (adminKeyBase64 == null || adminKeyBase64.trim() === '') {
    const clearedMap = Object.fromEntries(Object.entries(map).filter(([nodeId]) => nodeId !== id));
    mergeAppSetting(settingKey, '', 'meshtasticRemoteAdminKeyStorage clear');
    try {
      await window.electronAPI.appSettings.set(settingKey, '');
    } catch (e: unknown) {
      console.warn(
        '[meshtasticRemoteAdminKeyStorage] persist clear failed ' + errLikeToLogString(e),
      );
      throw e instanceof Error ? e : new Error(String(e));
    }
    return clearedMap;
  }

  const normalized = normalizeMeshtasticAdminKeyInput(adminKeyBase64);
  if (!normalized) {
    throw new Error('remoteAdmin.errors.invalidAdminKey');
  }
  map[id] = normalized;
  mergeAppSetting(settingKey, normalized, 'meshtasticRemoteAdminKeyStorage set');
  try {
    await window.electronAPI.appSettings.set(settingKey, normalized);
  } catch (e: unknown) {
    console.warn('[meshtasticRemoteAdminKeyStorage] persist failed ' + errLikeToLogString(e));
    throw e instanceof Error ? e : new Error(String(e));
  }
  return map;
}
