import { parseStoredJson } from './parseStoredJson';
import type { MeshProtocol } from './types';

const LEGACY_OPEN_DM_TABS_KEY = 'mesh-client:openDmTabs';
const LEGACY_LAST_READ_KEY = 'mesh-client:lastRead';

export function openDmTabsStorageKey(protocol: MeshProtocol): string {
  return `mesh-client:openDmTabs:${protocol}`;
}

export function lastReadStorageKey(protocol: MeshProtocol): string {
  return `mesh-client:lastRead:${protocol}`;
}

export function dismissedDmTabsStorageKey(protocol: MeshProtocol): string {
  return `mesh-client:dismissedDmTabs:${protocol}`;
}

/** Load persisted open DM tab node ids for this protocol; migrates legacy key into Meshtastic only. */
export function loadOpenDmTabsInitial(protocol: MeshProtocol): number[] {
  const key = openDmTabsStorageKey(protocol);
  const specific = localStorage.getItem(key);
  if (specific != null) {
    const parsed = parseStoredJson<unknown>(specific, 'ChatPanel openDmTabs');
    if (Array.isArray(parsed) && parsed.every((n: unknown) => typeof n === 'number')) {
      return parsed;
    }
  }
  if (protocol === 'meshtastic') {
    const legacy = localStorage.getItem(LEGACY_OPEN_DM_TABS_KEY);
    if (legacy != null) {
      const parsed = parseStoredJson<unknown>(legacy, 'ChatPanel openDmTabs legacy');
      if (Array.isArray(parsed) && parsed.every((n: unknown) => typeof n === 'number')) {
        try {
          localStorage.setItem(key, legacy);
        } catch (e) {
          console.debug('[chatPanelProtocolStorage] migrate openDmTabs to protocol key failed', e);
        }
        return parsed;
      }
    }
  }
  return [];
}

/** Load persisted last-read map for this protocol; migrates legacy key into Meshtastic only. */
export function loadPersistedLastReadInitial(protocol: MeshProtocol): Record<string, number> {
  const key = lastReadStorageKey(protocol);
  const specific = localStorage.getItem(key);
  if (specific != null) {
    const parsed = parseStoredJson<Record<string, number>>(specific, 'ChatPanel lastRead');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  }
  if (protocol === 'meshtastic') {
    const legacy = localStorage.getItem(LEGACY_LAST_READ_KEY);
    if (legacy != null) {
      const parsed = parseStoredJson<Record<string, number>>(legacy, 'ChatPanel lastRead legacy');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        try {
          localStorage.setItem(key, legacy);
        } catch (e) {
          console.debug('[chatPanelProtocolStorage] migrate lastRead to protocol key failed', e);
        }
        return parsed;
      }
    }
  }
  return {};
}
