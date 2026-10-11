import { errLikeToLogString } from './errLikeToLogString';
import {
  getCachedSecureSecret,
  listCachedSecureSecretKeys,
  removeSecureSecret,
  setSecureSecret,
} from './secureSecretStorage';

export interface MeshcorePerNodeCredentialStorageConfig<T> {
  prefix: string;
  logTag: string;
  parseValue: (raw: unknown) => T | undefined;
  serialize: (cred: T) => string;
  securePrefix: string;
}

export interface MeshcorePerNodeCredentialStorage<T> {
  prefix: string;
  settingKeyForNode: (nodeId: number) => string;
  readMap: () => Map<number, T>;
  get: (nodeId: number) => T | undefined;
  listNodeIds: () => number[];
  set: (nodeId: number, cred: T | null) => Promise<void>;
}

/**
 * Shared skeleton for legacy credential values stored as plain strings or JSON objects.
 * Callers supply field mapping via `fromPlainString` / `fromObject`.
 */
export function parseLegacyCredentialRaw<T>(
  raw: unknown,
  mappers: {
    fromPlainString: (value: string) => T | undefined;
    fromObject: (o: Record<string, unknown>) => T | undefined;
  },
): T | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') {
    if (!raw.trim()) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      // catch-no-log-ok legacy plain-string credential is not JSON
      return mappers.fromPlainString(raw);
    }
    return parseLegacyCredentialRaw(parsed, mappers);
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return mappers.fromObject(raw as Record<string, unknown>);
}

export function createMeshcorePerNodeCredentialStorage<T>(
  config: MeshcorePerNodeCredentialStorageConfig<T>,
): MeshcorePerNodeCredentialStorage<T> {
  const settingKeyForNode = (nodeId: number): string => `${config.prefix}${String(nodeId >>> 0)}`;

  const readMap = (): Map<number, T> => {
    const out = new Map<number, T>();
    for (const key of listCachedSecureSecretKeys(config.securePrefix)) {
      const idStr = key.slice(config.securePrefix.length);
      const nodeId = Number.parseInt(idStr, 10);
      if (!Number.isFinite(nodeId) || nodeId < 0) continue;
      const value = getCachedSecureSecret(key);
      const cred = config.parseValue(value);
      if (cred) out.set(nodeId >>> 0, cred);
    }
    return out;
  };

  const get = (nodeId: number): T | undefined => readMap().get(nodeId >>> 0);

  const listNodeIds = (): number[] => [...readMap().keys()];

  const set = async (nodeId: number, cred: T | null): Promise<void> => {
    const secureKey = `${config.securePrefix}${String(nodeId >>> 0)}`;
    try {
      if (cred == null) await removeSecureSecret(secureKey);
      else await setSecureSecret(secureKey, config.serialize(cred));
    } catch (e: unknown) {
      console.warn(`[${config.logTag}] secure store failed ` + errLikeToLogString(e));
      throw e instanceof Error ? e : new Error(String(e));
    }
  };

  return {
    prefix: config.prefix,
    settingKeyForNode,
    readMap,
    get,
    listNodeIds,
    set,
  };
}
