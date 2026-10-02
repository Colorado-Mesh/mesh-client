import {
  isMeshProtocol,
  type MeshProtocol,
  REGISTERED_MESH_PROTOCOLS,
} from '@/shared/meshProtocol';

import { getAppSettingsRaw } from './appSettingsStorage';
import { DEFAULT_APP_SETTINGS_SHARED } from './defaultAppSettings';
import { parseStoredJson } from './parseStoredJson';
import { getStoredMeshProtocol, MESH_PROTOCOL_STORAGE_KEY } from './storedMeshProtocol';

/**
 * Keeps only registered protocols, drops duplicates, and never hides every protocol
 * (an all-hidden value falls back to the default of none hidden).
 */
export function sanitizeHiddenProtocols(raw: unknown): MeshProtocol[] {
  if (!Array.isArray(raw)) return [...DEFAULT_APP_SETTINGS_SHARED.hiddenProtocols];
  const hidden: MeshProtocol[] = [];
  for (const value of raw) {
    if (typeof value === 'string' && isMeshProtocol(value) && !hidden.includes(value)) {
      hidden.push(value);
    }
  }
  if (hidden.length >= REGISTERED_MESH_PROTOCOLS.length) {
    return [...DEFAULT_APP_SETTINGS_SHARED.hiddenProtocols];
  }
  return hidden;
}

/** Hidden protocols from `mesh-client:appSettings` (App → Protocols). */
export function loadHiddenProtocols(): MeshProtocol[] {
  const parsed = parseStoredJson<{ hiddenProtocols?: unknown }>(
    getAppSettingsRaw(),
    'loadHiddenProtocols',
  );
  return sanitizeHiddenProtocols(parsed?.hiddenProtocols);
}

/** Registered protocols minus hidden ones, in registry order; always at least one. */
export function enabledProtocolsFrom(hidden: readonly MeshProtocol[]): MeshProtocol[] {
  const enabled = REGISTERED_MESH_PROTOCOLS.filter((p) => !hidden.includes(p));
  return enabled.length > 0 ? enabled : [...REGISTERED_MESH_PROTOCOLS];
}

/** `current` when enabled, otherwise the first enabled protocol. */
export function resolveEnabledProtocol(
  current: MeshProtocol,
  enabled: readonly MeshProtocol[],
): MeshProtocol {
  if (enabled.includes(current)) return current;
  return enabled[0] ?? current;
}

/**
 * Stored active protocol, redirected to the first enabled protocol when the stored one is
 * hidden. Writes the redirect back so runtimes reading `mesh-client:protocol` agree with the UI.
 */
export function getStoredEnabledMeshProtocol(): MeshProtocol {
  const stored = getStoredMeshProtocol();
  const resolved = resolveEnabledProtocol(stored, enabledProtocolsFrom(loadHiddenProtocols()));
  if (resolved !== stored) {
    try {
      localStorage.setItem(MESH_PROTOCOL_STORAGE_KEY, resolved);
    } catch {
      // catch-no-log-ok localStorage quota or private mode; in-memory state still resolves
    }
  }
  return resolved;
}

/** Protocols that became hidden between two settings values. */
export function newlyHiddenProtocols(
  prevHidden: readonly MeshProtocol[],
  nextHidden: readonly MeshProtocol[],
): MeshProtocol[] {
  return nextHidden.filter((p) => !prevHidden.includes(p));
}
