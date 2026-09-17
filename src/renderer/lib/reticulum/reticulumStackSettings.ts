/** Default stack-level identity re-announce interval (1 hour); mirrors sidecar `DEFAULT_ANNOUNCE_INTERVAL_SEC`. */
export const DEFAULT_ANNOUNCE_INTERVAL_SEC = 3600;

/** Upstream rsReticulum / Python default discovery stamp gate. */
export const DEFAULT_REQUIRED_DISCOVERY_VALUE = 16;

export interface ReticulumStackSettingsFields {
  enable_transport?: boolean;
  share_instance?: boolean;
  loglevel?: string | number;
  announce_interval_sec?: number;
  autoconnect_discovered_interfaces?: number;
  required_discovery_value?: number;
  interface_discovery_sources?: string;
  network_identity?: string;
}

export interface ReticulumStackSettingsPayload {
  enable_transport: boolean;
  share_instance: boolean;
  loglevel: number;
  announce_interval_sec: number;
  autoconnect_discovered_interfaces: number;
  required_discovery_value: number;
  interface_discovery_sources: string;
  network_identity: string;
}

/** Parse stack settings JSON from the sidecar config file. */
export function parseReticulumStackSettings(raw: unknown): ReticulumStackSettingsFields {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  const out: ReticulumStackSettingsFields = {};
  if (typeof obj.enable_transport === 'boolean') {
    out.enable_transport = obj.enable_transport;
  }
  if (typeof obj.share_instance === 'boolean') {
    out.share_instance = obj.share_instance;
  }
  if (typeof obj.loglevel === 'string' || typeof obj.loglevel === 'number') {
    out.loglevel = obj.loglevel;
  }
  if (typeof obj.announce_interval_sec === 'number' && Number.isFinite(obj.announce_interval_sec)) {
    out.announce_interval_sec = obj.announce_interval_sec;
  }
  if (
    typeof obj.autoconnect_discovered_interfaces === 'number' &&
    Number.isFinite(obj.autoconnect_discovered_interfaces)
  ) {
    out.autoconnect_discovered_interfaces = obj.autoconnect_discovered_interfaces;
  }
  if (
    typeof obj.required_discovery_value === 'number' &&
    Number.isFinite(obj.required_discovery_value)
  ) {
    out.required_discovery_value = obj.required_discovery_value;
  }
  if (typeof obj.interface_discovery_sources === 'string') {
    out.interface_discovery_sources = obj.interface_discovery_sources;
  }
  if (typeof obj.network_identity === 'string') {
    out.network_identity = obj.network_identity;
  }
  return out;
}

/** Coerce announce interval from stack settings JSON; preserves explicit `0`. */
export function coerceAnnounceIntervalSec(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n !== 0 ? n : DEFAULT_ANNOUNCE_INTERVAL_SEC;
}

export function clampAutoconnectDiscoveredInterfaces(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(32, Math.round(value));
}

export function clampRequiredDiscoveryValue(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_REQUIRED_DISCOVERY_VALUE;
  }
  return Math.min(32, Math.max(1, Math.round(value)));
}

/** Validate comma/whitespace-separated 32-hex discovery source hashes. */
export function validateInterfaceDiscoverySources(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  for (const part of trimmed.split(/[,\s]+/)) {
    if (!part) continue;
    if (part.length !== 32 || !/^[0-9a-fA-F]+$/.test(part)) {
      return 'invalid';
    }
  }
  return null;
}

/** Parse stack settings with defaults used by RMAP and announce apply paths. */
export function parseReticulumStackSettingsPayload(raw: unknown): ReticulumStackSettingsPayload {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    enable_transport: Boolean(obj.enable_transport),
    share_instance: Boolean(obj.share_instance),
    loglevel: typeof obj.loglevel === 'number' ? obj.loglevel : Number(obj.loglevel) || 4,
    announce_interval_sec: coerceAnnounceIntervalSec(obj.announce_interval_sec),
    autoconnect_discovered_interfaces: clampAutoconnectDiscoveredInterfaces(
      typeof obj.autoconnect_discovered_interfaces === 'number'
        ? obj.autoconnect_discovered_interfaces
        : Number(obj.autoconnect_discovered_interfaces) || 0,
    ),
    required_discovery_value: clampRequiredDiscoveryValue(
      typeof obj.required_discovery_value === 'number'
        ? obj.required_discovery_value
        : Number(obj.required_discovery_value) || DEFAULT_REQUIRED_DISCOVERY_VALUE,
    ),
    interface_discovery_sources:
      typeof obj.interface_discovery_sources === 'string' ? obj.interface_discovery_sources : '',
    network_identity: typeof obj.network_identity === 'string' ? obj.network_identity : '',
  };
}

export type ReticulumStackSettingsPatch = Partial<ReticulumStackSettingsPayload>;

/** PUT only changed stack-settings fields; sidecar merges omitted keys atomically. */
export async function patchReticulumStackSettings(
  patch: ReticulumStackSettingsPatch,
): Promise<{ ok?: boolean; error?: string }> {
  const body: Record<string, unknown> = {};
  if (patch.enable_transport !== undefined) body.enable_transport = patch.enable_transport;
  if (patch.share_instance !== undefined) body.share_instance = patch.share_instance;
  if (patch.loglevel !== undefined) body.loglevel = patch.loglevel;
  if (patch.announce_interval_sec !== undefined) {
    body.announce_interval_sec = patch.announce_interval_sec;
  }
  if (patch.autoconnect_discovered_interfaces !== undefined) {
    body.autoconnect_discovered_interfaces = patch.autoconnect_discovered_interfaces;
  }
  if (patch.required_discovery_value !== undefined) {
    body.required_discovery_value = patch.required_discovery_value;
  }
  if (patch.interface_discovery_sources !== undefined) {
    body.interface_discovery_sources = patch.interface_discovery_sources;
  }
  if (patch.network_identity !== undefined) body.network_identity = patch.network_identity;
  return (await window.electronAPI.reticulum.proxyPut('/api/v1/stack/settings', body)) as {
    ok?: boolean;
    error?: string;
  };
}
