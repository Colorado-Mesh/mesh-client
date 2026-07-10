import { mergeAppSetting } from '@/renderer/lib/appSettingsStorage';
import { readStoredStaticGps } from '@/renderer/lib/gpsSource';
import {
  buildDefaultHubAddRequest,
  RETICULUM_RMAP_WORLD_HUB_PRESET,
  reticulumInterfaceMatchesHubPreset,
} from '@/renderer/lib/reticulum/reticulumDefaultHubPresets';
import type { ReticulumInterfaceRow } from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';
import { isValidConnectHost } from '@/shared/connectHost';
import { isValidLatLon } from '@/shared/geoCoords';
import { isReticulumLocallyConnectedSerialInterface } from '@/shared/reticulumLocalRnodePrimary';

export const RMAP_ANNOUNCE_INTERVAL_DEFAULT_MIN = 360;
export const RMAP_ANNOUNCE_INTERVAL_MIN_MIN = 60;
export const RMAP_ANNOUNCE_INTERVAL_MIN_MAX = 1440;
export const RMAP_REACHABLE_ON_MAX_LEN = 256;

export const RMAP_SETTINGS_KEYS = {
  announceIntervalMin: 'reticulumRmapAnnounceIntervalMin',
  reachableOn: 'reticulumRmapReachableOn',
  heightMeters: 'reticulumRmapHeightMeters',
} as const;

export interface RmapCoordinates {
  lat: number;
  lon: number;
}

export interface RmapDiscoveryPatchOptions {
  coords: RmapCoordinates;
  discoveryName?: string | null;
  announceIntervalMin: number;
  heightMeters?: number | null;
  reachableOn?: string | null;
  discoverable: boolean;
}

export interface ReticulumRmapDiscoveryPatch {
  discoverable?: boolean;
  latitude?: number;
  longitude?: number;
  height?: number;
  discovery_name?: string;
  announce_interval_min?: number;
  connectable?: boolean;
  reachable_on?: string;
}

export class ReticulumRmapGpsRequiredError extends Error {
  constructor() {
    super('gps_required');
    this.name = 'ReticulumRmapGpsRequiredError';
  }
}

export class ReticulumRmapValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReticulumRmapValidationError';
  }
}

export function clampRmapAnnounceIntervalMin(value: number): number {
  if (!Number.isFinite(value)) {
    return RMAP_ANNOUNCE_INTERVAL_DEFAULT_MIN;
  }
  return Math.min(
    RMAP_ANNOUNCE_INTERVAL_MIN_MAX,
    Math.max(RMAP_ANNOUNCE_INTERVAL_MIN_MIN, Math.round(value)),
  );
}

export function validateRmapReachableOn(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > RMAP_REACHABLE_ON_MAX_LEN) {
    return 'too_long';
  }
  if (trimmed.includes('\n') || trimmed.includes('\r') || trimmed.includes('\0')) {
    return 'invalid';
  }
  const looksLikeScript = trimmed.includes('/') || trimmed.includes('$');
  if (!looksLikeScript && !isValidConnectHost(trimmed)) {
    return 'invalid_host';
  }
  return null;
}

/** Enabled local RNode/BLE/KISS or I2P — excludes outbound TCP/auto hubs. */
export function isReticulumRmapPublishTarget(
  row: Pick<ReticulumInterfaceRow, 'type' | 'enabled' | 'serial_port'>,
): boolean {
  if (!row.enabled) {
    return false;
  }
  const type = row.type.trim().toLowerCase();
  if (type === 'i2p') {
    return true;
  }
  if (type === 'ble_peer') {
    return true;
  }
  return isReticulumLocallyConnectedSerialInterface({
    id: '',
    type: row.type,
    enabled: row.enabled,
    serial_port: row.serial_port,
  });
}

export function listReticulumRmapPublishTargets(
  interfaces: readonly ReticulumInterfaceRow[],
): ReticulumInterfaceRow[] {
  return interfaces.filter(isReticulumRmapPublishTarget);
}

export function readRmapPublishState(interfaces: readonly ReticulumInterfaceRow[]): boolean {
  return listReticulumRmapPublishTargets(interfaces).some((row) => row.discoverable === true);
}

export function resolveRmapCoordinates(): RmapCoordinates | null {
  const stored = readStoredStaticGps();
  if (!stored || !isValidLatLon(stored.lat, stored.lon)) {
    return null;
  }
  return stored;
}

export function buildRmapDiscoveryPatch(
  row: Pick<ReticulumInterfaceRow, 'type'>,
  opts: RmapDiscoveryPatchOptions,
): ReticulumRmapDiscoveryPatch {
  const patch: ReticulumRmapDiscoveryPatch = {
    discoverable: opts.discoverable,
  };
  if (opts.discoverable) {
    patch.latitude = opts.coords.lat;
    patch.longitude = opts.coords.lon;
    patch.announce_interval_min = clampRmapAnnounceIntervalMin(opts.announceIntervalMin);
    if (opts.discoveryName?.trim()) {
      patch.discovery_name = opts.discoveryName.trim();
    }
    if (opts.heightMeters != null && Number.isFinite(opts.heightMeters) && opts.heightMeters >= 0) {
      patch.height = Math.round(opts.heightMeters);
    }
    const reachable = opts.reachableOn?.trim();
    if (reachable) {
      patch.reachable_on = reachable;
    }
    if (row.type.trim().toLowerCase() === 'i2p') {
      patch.connectable = true;
    }
  }
  return patch;
}

export function buildRmapDisablePatch(): ReticulumRmapDiscoveryPatch {
  return { discoverable: false };
}

export function persistRmapUiPrefs(prefs: {
  announceIntervalMin: number;
  reachableOn: string;
  heightMeters: string;
}): void {
  mergeAppSetting(
    RMAP_SETTINGS_KEYS.announceIntervalMin,
    clampRmapAnnounceIntervalMin(prefs.announceIntervalMin),
    'reticulumRmapDiscovery persist',
  );
  mergeAppSetting(
    RMAP_SETTINGS_KEYS.reachableOn,
    prefs.reachableOn.trim(),
    'reticulumRmapDiscovery persist',
  );
  const height = prefs.heightMeters.trim();
  if (height) {
    const parsed = Number(height);
    if (Number.isFinite(parsed) && parsed >= 0) {
      mergeAppSetting(
        RMAP_SETTINGS_KEYS.heightMeters,
        Math.round(parsed),
        'reticulumRmapDiscovery persist',
      );
    }
  }
  void window.electronAPI.appSettings.set(
    RMAP_SETTINGS_KEYS.announceIntervalMin,
    String(clampRmapAnnounceIntervalMin(prefs.announceIntervalMin)),
  );
  void window.electronAPI.appSettings.set(RMAP_SETTINGS_KEYS.reachableOn, prefs.reachableOn.trim());
  if (height) {
    void window.electronAPI.appSettings.set(RMAP_SETTINGS_KEYS.heightMeters, height);
  }
}

async function ensureRmapWorldHubEnabled(
  interfaces: readonly ReticulumInterfaceRow[],
): Promise<void> {
  const existing = interfaces.find((row) =>
    reticulumInterfaceMatchesHubPreset(row, RETICULUM_RMAP_WORLD_HUB_PRESET),
  );
  if (existing) {
    if (!existing.enabled) {
      await window.electronAPI.reticulum.proxyPost(`/api/v1/interfaces/${existing.id}/enable`, {});
    }
    return;
  }
  const body = {
    ...buildDefaultHubAddRequest(RETICULUM_RMAP_WORLD_HUB_PRESET),
    enabled: true,
  };
  const created = (await window.electronAPI.reticulum.proxyPost('/api/v1/interfaces', body)) as {
    id?: string;
  };
  if (created.id) {
    await window.electronAPI.reticulum.proxyPost(`/api/v1/interfaces/${created.id}/enable`, {});
  }
}

export interface ApplyReticulumRmapDiscoveryArgs {
  interfaces: readonly ReticulumInterfaceRow[];
  discoveryName?: string | null;
  announceIntervalMin: number;
  heightMeters?: number | null;
  reachableOn?: string | null;
  stackSettings: { enable_transport: boolean; share_instance: boolean; loglevel: number };
}

export async function applyReticulumRmapDiscovery(
  args: ApplyReticulumRmapDiscoveryArgs,
): Promise<void> {
  const coords = resolveRmapCoordinates();
  if (!coords) {
    throw new ReticulumRmapGpsRequiredError();
  }
  const reachable = args.reachableOn?.trim() ?? '';
  if (reachable) {
    const err = validateRmapReachableOn(reachable);
    if (err) {
      throw new ReticulumRmapValidationError(err);
    }
  }

  const announceIntervalMin = clampRmapAnnounceIntervalMin(args.announceIntervalMin);
  const targets = listReticulumRmapPublishTargets(args.interfaces);
  if (targets.length === 0) {
    throw new ReticulumRmapValidationError('no_publish_targets');
  }

  if (!args.stackSettings.enable_transport) {
    await window.electronAPI.reticulum.proxyPut('/api/v1/stack/settings', {
      ...args.stackSettings,
      enable_transport: true,
    });
  }

  for (const row of targets) {
    const patch = buildRmapDiscoveryPatch(row, {
      coords,
      discoveryName: args.discoveryName,
      announceIntervalMin,
      heightMeters: args.heightMeters,
      reachableOn: reachable || null,
      discoverable: true,
    });
    await window.electronAPI.reticulum.proxyPut(`/api/v1/interfaces/${row.id}`, patch);
  }

  await ensureRmapWorldHubEnabled(args.interfaces);
}

export async function disableReticulumRmapDiscovery(
  interfaces: readonly ReticulumInterfaceRow[],
): Promise<void> {
  const patch = buildRmapDisablePatch();
  for (const row of listReticulumRmapPublishTargets(interfaces)) {
    if (row.discoverable) {
      await window.electronAPI.reticulum.proxyPut(`/api/v1/interfaces/${row.id}`, patch);
    }
  }
}
