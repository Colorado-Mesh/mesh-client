import { errLikeToLogString } from './errLikeToLogString';

const CHAT_ORDER_PREFIX = 'mesh-client:chatOrder:';

function storageKey(protocol: string, nodeScope: string, kind: 'channels' | 'dms'): string {
  return `${CHAT_ORDER_PREFIX}${protocol}:${nodeScope}:${kind}`;
}

/** Legacy pre-connect scope written as `:0:` before `myNodeNum` was known. */
function legacyStorageKey(protocol: string, kind: 'channels' | 'dms'): string {
  return storageKey(protocol, '0', kind);
}

/**
 * Move legacy `:0:` chat order to the resolved node scope before hooks read storage.
 * Keeps the legacy key when the destination cannot be written.
 */
export function migrateLegacyChatOrderScope(protocol: string, nodeScope: string): void {
  for (const kind of ['channels', 'dms'] as const) {
    const fromKey = legacyStorageKey(protocol, kind);
    const toKey = storageKey(protocol, nodeScope, kind);
    let raw: string | null;
    try {
      raw = localStorage.getItem(fromKey);
    } catch (error) {
      console.warn('[chatOrderScope] read legacy key failed ' + errLikeToLogString(error));
      continue;
    }
    if (raw == null) continue;
    let destMissing: boolean;
    try {
      destMissing = localStorage.getItem(toKey) == null;
    } catch (error) {
      console.warn('[chatOrderScope] read dest key failed ' + errLikeToLogString(error));
      continue;
    }
    if (destMissing) {
      try {
        localStorage.setItem(toKey, raw);
      } catch (error) {
        console.warn('[chatOrderScope] copy legacy order failed ' + errLikeToLogString(error));
        continue;
      }
      try {
        const verify = localStorage.getItem(toKey);
        if (verify !== raw) continue;
      } catch (error) {
        console.warn('[chatOrderScope] verify dest key failed ' + errLikeToLogString(error));
        continue;
      }
      try {
        localStorage.removeItem(fromKey);
      } catch (error) {
        console.warn('[chatOrderScope] remove legacy key failed ' + errLikeToLogString(error));
      }
      continue;
    }
    try {
      const destRaw = localStorage.getItem(toKey);
      if (destRaw === raw) {
        localStorage.removeItem(fromKey);
      }
    } catch (error) {
      console.warn('[chatOrderScope] compare dest key failed ' + errLikeToLogString(error));
    }
  }
}

export function chatOrderScopeKey(
  protocol: string,
  nodeScope: string | null,
  kind: 'channels' | 'dms',
): string | null {
  if (nodeScope == null) return null;
  return `${protocol}:${nodeScope}:${kind}`;
}
