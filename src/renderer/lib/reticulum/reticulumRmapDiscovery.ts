import { getAppSettingsRaw, mergeAppSetting } from '@/renderer/lib/appSettingsStorage';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { readStoredStaticGps } from '@/renderer/lib/gpsSource';
import { parseStoredJson } from '@/renderer/lib/parseStoredJson';
import {
  buildDefaultHubAddRequest,
  RETICULUM_RMAP_WORLD_HUB_PRESET,
  reticulumInterfaceMatchesHubPreset,
} from '@/renderer/lib/reticulum/reticulumDefaultHubPresets';
import { invalidateReticulumInterfacesCache } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import type { ReticulumInterfaceRow } from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';
import { isValidConnectHost } from '@/shared/connectHost';
import { isValidLatLon } from '@/shared/geoCoords';

export const RMAP_GLOBAL_MAP_URL = 'https://rmap.world/';

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

/** Interface types mesh-client can mark discoverable for RMAP v4 (see rmap.world/info.html). */
const RMAP_DISCOVERY_EXCLUDED_TYPES = new Set(['auto', 'tcp']);

/**
 * Enabled interfaces that support per-interface discoverable=yes in rnsd config.
 * Excludes Auto (LAN) and outbound TCP client hubs — Scenario A server/backbone
 * interfaces are not CRUD-managed in mesh-client today.
 */
export function isReticulumRmapDiscoveryCapable(
  row: Pick<ReticulumInterfaceRow, 'type' | 'enabled' | 'serial_port'>,
): boolean {
  if (!row.enabled) {
    return false;
  }
  const type = row.type.trim().toLowerCase();
  if (RMAP_DISCOVERY_EXCLUDED_TYPES.has(type)) {
    return false;
  }
  if (type === 'i2p' || type === 'ble_peer' || type === 'pipe' || type === 'udp') {
    return true;
  }
  if (type === 'kiss' || type === 'rnode_multi' || type === 'rnode') {
    return Boolean(row.serial_port?.trim());
  }
  return false;
}

/** @deprecated Prefer isReticulumRmapDiscoveryCapable */
export const isReticulumRmapPublishTarget = isReticulumRmapDiscoveryCapable;

export function listReticulumRmapDiscoveryCapable(
  interfaces: readonly ReticulumInterfaceRow[],
): ReticulumInterfaceRow[] {
  return interfaces.filter(isReticulumRmapDiscoveryCapable);
}

/** @deprecated Prefer listReticulumRmapDiscoveryCapable */
export const listReticulumRmapPublishTargets = listReticulumRmapDiscoveryCapable;

export function readRmapPublishState(interfaces: readonly ReticulumInterfaceRow[]): boolean {
  return listReticulumRmapDiscoveryCapable(interfaces).some((row) => row.discoverable === true);
}

/** LoRa/BLE paths that need a TCP transport bridge to reach RMAP (Scenario B). */
export function isReticulumRmapLoRaDiscoveryRow(row: Pick<ReticulumInterfaceRow, 'type'>): boolean {
  const type = row.type.trim().toLowerCase();
  return type === 'rnode' || type === 'kiss' || type === 'rnode_multi' || type === 'ble_peer';
}

export interface RmapUiPrefs {
  announceIntervalMin: number;
  reachableOn: string;
  heightMeters: number | null;
}

export function readRmapUiPrefs(): RmapUiPrefs {
  const parsed = parseStoredJson<Record<string, unknown>>(
    getAppSettingsRaw(),
    'reticulumRmapDiscovery readRmapUiPrefs',
  );
  const announceRaw = parsed?.[RMAP_SETTINGS_KEYS.announceIntervalMin];
  const heightRaw = parsed?.[RMAP_SETTINGS_KEYS.heightMeters];
  let heightMeters: number | null = null;
  if (heightRaw != null) {
    const parsedHeight = Number(heightRaw);
    if (Number.isFinite(parsedHeight) && parsedHeight >= 0) {
      heightMeters = Math.round(parsedHeight);
    }
  }
  return {
    announceIntervalMin:
      announceRaw != null
        ? clampRmapAnnounceIntervalMin(Number(announceRaw))
        : RMAP_ANNOUNCE_INTERVAL_DEFAULT_MIN,
    reachableOn:
      typeof parsed?.[RMAP_SETTINGS_KEYS.reachableOn] === 'string'
        ? (parsed[RMAP_SETTINGS_KEYS.reachableOn] as string)
        : '',
    heightMeters,
  };
}

export interface RmapPublishStatusSummary {
  publishing: boolean;
  discoverableCount: number;
  publishTargetCount: number;
  needsSyncCount: number;
}

export function summarizeRmapPublishStatus(
  interfaces: readonly ReticulumInterfaceRow[],
): RmapPublishStatusSummary {
  const targets = listReticulumRmapDiscoveryCapable(interfaces);
  const discoverableTargets = targets.filter((row) => row.discoverable === true);
  const publishing = discoverableTargets.length > 0;
  return {
    publishing,
    discoverableCount: discoverableTargets.length,
    publishTargetCount: targets.length,
    needsSyncCount: publishing ? targets.filter((row) => row.discoverable !== true).length : 0,
  };
}

export function isReticulumRmapDiscoverableRow(
  iface: Pick<ReticulumInterfaceRow, 'type' | 'enabled' | 'serial_port' | 'discoverable'>,
): boolean {
  return iface.discoverable === true && isReticulumRmapDiscoveryCapable(iface);
}

export function isReticulumRmapNeedsSyncRow(
  iface: Pick<ReticulumInterfaceRow, 'type' | 'enabled' | 'serial_port' | 'discoverable'>,
  interfaces: readonly ReticulumInterfaceRow[],
): boolean {
  return (
    readRmapPublishState(interfaces) &&
    isReticulumRmapDiscoveryCapable(iface) &&
    iface.discoverable !== true
  );
}

async function fetchReticulumInterfaceRows(): Promise<ReticulumInterfaceRow[]> {
  invalidateReticulumInterfacesCache();
  const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/interfaces')) as {
    interfaces?: ReticulumInterfaceRow[];
  };
  return body.interfaces ?? [];
}

export async function syncReticulumRmapDiscoveryToInterface(
  iface: ReticulumInterfaceRow,
  opts: { discoveryName?: string | null },
): Promise<boolean> {
  if (!iface.enabled || !isReticulumRmapDiscoveryCapable(iface) || iface.discoverable === true) {
    return false;
  }
  const coords = resolveRmapCoordinates();
  if (!coords) {
    console.debug('[reticulumRmapDiscovery] sync skipped: GPS missing');
    return false;
  }
  const prefs = readRmapUiPrefs();
  const reachable = prefs.reachableOn.trim();
  if (reachable) {
    const err = validateRmapReachableOn(reachable);
    if (err) {
      console.debug('[reticulumRmapDiscovery] sync skipped: invalid reachable_on');
      return false;
    }
  }
  const patch = buildRmapDiscoveryPatch(iface, {
    coords,
    discoveryName: opts.discoveryName,
    announceIntervalMin: prefs.announceIntervalMin,
    heightMeters: prefs.heightMeters,
    reachableOn: reachable || null,
    discoverable: true,
  });
  await window.electronAPI.reticulum.proxyPut(`/api/v1/interfaces/${iface.id}`, patch);
  return true;
}

/** When RMAP publish is on, patch discovery onto a newly enabled publish-target interface. */
export async function maybeSyncReticulumRmapAfterInterfaceEnable(
  interfaceId: string,
  opts: { discoveryName?: string | null },
): Promise<boolean> {
  const interfaces = await fetchReticulumInterfaceRows();
  if (!readRmapPublishState(interfaces)) {
    return false;
  }
  const iface = interfaces.find((row) => row.id === interfaceId);
  if (!iface) {
    return false;
  }
  return syncReticulumRmapDiscoveryToInterface(iface, opts);
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

export interface RmapBatchApplyResult {
  applied: number;
  total: number;
  errors: string[];
}

export async function applyReticulumRmapDiscovery(
  args: ApplyReticulumRmapDiscoveryArgs,
): Promise<RmapBatchApplyResult> {
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
  const targets = listReticulumRmapDiscoveryCapable(args.interfaces);
  if (targets.length === 0) {
    throw new ReticulumRmapValidationError('no_publish_targets');
  }

  const errors: string[] = [];
  let applied = 0;

  const needsTransportBridge = targets.some(isReticulumRmapLoRaDiscoveryRow);
  if (needsTransportBridge && !args.stackSettings.enable_transport) {
    try {
      await window.electronAPI.reticulum.proxyPut('/api/v1/stack/settings', {
        ...args.stackSettings,
        enable_transport: true,
      });
    } catch (e) {
      // catch-no-log-ok partial apply — surfaced via RmapBatchApplyResult.errors
      errors.push(errLikeToLogString(e));
    }
  }

  for (const row of targets) {
    try {
      const patch = buildRmapDiscoveryPatch(row, {
        coords,
        discoveryName: args.discoveryName,
        announceIntervalMin,
        heightMeters: args.heightMeters,
        reachableOn: reachable || null,
        discoverable: true,
      });
      await window.electronAPI.reticulum.proxyPut(`/api/v1/interfaces/${row.id}`, patch);
      applied++;
    } catch (e) {
      // catch-no-log-ok partial apply — surfaced via RmapBatchApplyResult.errors
      errors.push(errLikeToLogString(e));
    }
  }

  if (needsTransportBridge) {
    try {
      await ensureRmapWorldHubEnabled(args.interfaces);
    } catch (e) {
      // catch-no-log-ok partial apply — surfaced via RmapBatchApplyResult.errors
      errors.push(errLikeToLogString(e));
    }
  }

  return { applied, total: targets.length, errors };
}

export interface SetReticulumRmapDiscoverableArgs {
  discoveryName?: string | null;
  announceIntervalMin?: number;
  heightMeters?: number | null;
  reachableOn?: string | null;
  interfaces: readonly ReticulumInterfaceRow[];
  stackSettings: { enable_transport: boolean; share_instance: boolean; loglevel: number };
}

/** Enable or disable RMAP discovery on a single capable interface. */
export async function setReticulumRmapDiscoverableForInterface(
  iface: ReticulumInterfaceRow,
  enable: boolean,
  args: SetReticulumRmapDiscoverableArgs,
): Promise<void> {
  if (!isReticulumRmapDiscoveryCapable(iface)) {
    throw new ReticulumRmapValidationError('not_capable');
  }
  if (!enable) {
    await window.electronAPI.reticulum.proxyPut(
      `/api/v1/interfaces/${iface.id}`,
      buildRmapDisablePatch(),
    );
    return;
  }

  const coords = resolveRmapCoordinates();
  if (!coords) {
    throw new ReticulumRmapGpsRequiredError();
  }

  const prefs = readRmapUiPrefs();
  const announceIntervalMin = clampRmapAnnounceIntervalMin(
    args.announceIntervalMin ?? prefs.announceIntervalMin,
  );
  const heightMeters = args.heightMeters ?? prefs.heightMeters;
  const reachable = (args.reachableOn ?? prefs.reachableOn).trim();
  if (reachable) {
    const err = validateRmapReachableOn(reachable);
    if (err) {
      throw new ReticulumRmapValidationError(err);
    }
  }

  if (isReticulumRmapLoRaDiscoveryRow(iface)) {
    if (!args.stackSettings.enable_transport) {
      await window.electronAPI.reticulum.proxyPut('/api/v1/stack/settings', {
        ...args.stackSettings,
        enable_transport: true,
      });
    }
    await ensureRmapWorldHubEnabled(args.interfaces);
  }

  const patch = buildRmapDiscoveryPatch(iface, {
    coords,
    discoveryName: args.discoveryName,
    announceIntervalMin,
    heightMeters,
    reachableOn: reachable || null,
    discoverable: true,
  });
  await window.electronAPI.reticulum.proxyPut(`/api/v1/interfaces/${iface.id}`, patch);
}

export async function disableReticulumRmapDiscovery(
  interfaces: readonly ReticulumInterfaceRow[],
): Promise<RmapBatchApplyResult> {
  const patch = buildRmapDisablePatch();
  const targets = listReticulumRmapDiscoveryCapable(interfaces).filter((row) => row.discoverable);
  const errors: string[] = [];
  let applied = 0;
  for (const row of targets) {
    try {
      await window.electronAPI.reticulum.proxyPut(`/api/v1/interfaces/${row.id}`, patch);
      applied++;
    } catch (e) {
      // catch-no-log-ok partial disable — surfaced via RmapBatchApplyResult.errors
      errors.push(errLikeToLogString(e));
    }
  }
  return { applied, total: targets.length, errors };
}
