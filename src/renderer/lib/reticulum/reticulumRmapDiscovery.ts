import { getAppSettingsRaw, mergeAppSetting } from '@/renderer/lib/appSettingsStorage';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { readStoredStaticGps } from '@/renderer/lib/gpsSource';
import { parseStoredJson } from '@/renderer/lib/parseStoredJson';
import {
  buildDefaultHubAddRequest,
  RETICULUM_RMAP_WORLD_HUB_PRESET,
  reticulumInterfaceMatchesHubPreset,
} from '@/renderer/lib/reticulum/reticulumDefaultHubPresets';
import { getReticulumInterfaceHelp } from '@/renderer/lib/reticulum/reticulumInterfaceHelp';
import { invalidateReticulumInterfacesCache } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import {
  patchReticulumStackSettings,
  type ReticulumStackSettingsPayload,
} from '@/renderer/lib/reticulum/reticulumStackSettings';
import type { ReticulumInterfaceRow } from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';
import { isValidConnectHost } from '@/shared/connectHost';
import { isValidLatLon } from '@/shared/geoCoords';

export const RMAP_GLOBAL_MAP_URL = 'https://rmap.world/';

export const RMAP_ANNOUNCE_INTERVAL_DEFAULT_MIN = 360;
export const RMAP_ANNOUNCE_INTERVAL_MIN_MIN = 60;
export const RMAP_ANNOUNCE_INTERVAL_MIN_MAX = 1440;
export const RMAP_REACHABLE_ON_MAX_LEN = 256;
/** Upstream rsReticulum DEFAULT_STAMP_VALUE (manual text still cites 14). */
export const RMAP_DISCOVERY_STAMP_DEFAULT = 16;
export const RMAP_DISCOVERY_STAMP_MIN = 8;
export const RMAP_DISCOVERY_STAMP_MAX = 32;
export const RMAP_DISCOVERY_LXMF_ADDRESS_MAX_LEN = 64;

export const RMAP_SETTINGS_KEYS = {
  announceIntervalMin: 'reticulumRmapAnnounceIntervalMin',
  reachableOn: 'reticulumRmapReachableOn',
  heightMeters: 'reticulumRmapHeightMeters',
  discoveryLxmfAddress: 'reticulumRmapDiscoveryLxmfAddress',
  discoveryStampValue: 'reticulumRmapDiscoveryStampValue',
  discoveryEncrypt: 'reticulumRmapDiscoveryEncrypt',
  publishIfac: 'reticulumRmapPublishIfac',
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
  discoveryLxmfAddress?: string | null;
  discoveryStampValue?: number | null;
  discoveryEncrypt?: boolean | null;
  publishIfac?: boolean | null;
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
  discovery_lxmf_address?: string;
  discovery_stamp_value?: number;
  discovery_encrypt?: boolean;
  publish_ifac?: boolean;
  discovery_frequency?: number;
  discovery_bandwidth?: number;
  discovery_spreading_factor?: number;
  discovery_coding_rate?: number;
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

export function clampRmapDiscoveryStampValue(value: number): number {
  if (!Number.isFinite(value)) {
    return RMAP_DISCOVERY_STAMP_DEFAULT;
  }
  return Math.min(RMAP_DISCOVERY_STAMP_MAX, Math.max(RMAP_DISCOVERY_STAMP_MIN, Math.round(value)));
}

/** Optional operator LXMF address shown on discovered-interface details (manual). */
export function validateRmapDiscoveryLxmfAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > RMAP_DISCOVERY_LXMF_ADDRESS_MAX_LEN) {
    return 'too_long';
  }
  // Canonical lxmf.delivery destination hash: 16 bytes → 32 hex chars.
  if (!/^[0-9a-fA-F]{32}$/.test(trimmed)) {
    return 'invalid';
  }
  return null;
}

/**
 * Server entrypoints (Backbone) need a public hostname/IP or resolution script
 * so remote peers can dial in. Empty is invalid when publishing Backbone.
 */
export function requireRmapReachableOnForServer(
  row: Pick<ReticulumInterfaceRow, 'type'>,
  reachableOn: string | null | undefined,
): string | null {
  if (!isReticulumRmapServerDiscoveryRow(row)) {
    return null;
  }
  const trimmed = reachableOn?.trim() ?? '';
  if (!trimmed) {
    return 'required';
  }
  return validateRmapReachableOn(trimmed);
}

/**
 * UI types whose upstream factory arms emit discovery announces
 * (`DISCOVERABLE_INTERFACE_TYPES` / `discovery_config_for_interface` in rsReticulum).
 * Excludes Auto (LAN), outbound TCP client hubs (only kiss-framed TCP clients
 * announce, which mesh-client does not expose), Weave (not in catalog), and
 * types that silently no-op when discoverable (udp/pipe/ble_peer/rnode_multi).
 */
const RMAP_DISCOVERY_CAPABLE_TYPES = new Set(['rnode', 'kiss', 'ax25kiss', 'i2p', 'backbone']);

/**
 * Enabled interfaces that support per-interface discoverable=yes in rnsd config.
 * Aligned with rsReticulum advertizable types. Excludes system-managed
 * shared-instance rows.
 */
export function isReticulumRmapDiscoveryCapable(
  row: Pick<ReticulumInterfaceRow, 'type' | 'enabled' | 'serial_port'> &
    Partial<Pick<ReticulumInterfaceRow, 'id' | 'name'>>,
): boolean {
  if (!row.enabled) {
    return false;
  }
  if (
    getReticulumInterfaceHelp({
      id: row.id ?? '',
      name: row.name ?? '',
      type: row.type,
      serial_port: row.serial_port,
    }).isSystemManaged
  ) {
    return false;
  }
  const type = row.type.trim().toLowerCase();
  if (!RMAP_DISCOVERY_CAPABLE_TYPES.has(type)) {
    return false;
  }
  if (type === 'i2p' || type === 'backbone') {
    return true;
  }
  // rnode / kiss / ax25kiss need a configured port (USB, ble://, or tcp://).
  return Boolean(row.serial_port?.trim());
}

export function listReticulumRmapDiscoveryCapable(
  interfaces: readonly ReticulumInterfaceRow[],
): ReticulumInterfaceRow[] {
  return interfaces.filter(isReticulumRmapDiscoveryCapable);
}

/** True when at least one eligible interface is discoverable (publishing intent / maybeSync). */
export function readRmapAnyPublishing(interfaces: readonly ReticulumInterfaceRow[]): boolean {
  return listReticulumRmapDiscoveryCapable(interfaces).some((row) => row.discoverable === true);
}

/**
 * Network "Publish on RMAP v4" checked state: true only when every eligible
 * enabled interface is discoverable. Partial coverage returns false so the user
 * can check again to enable-all.
 */
export function readRmapPublishState(interfaces: readonly ReticulumInterfaceRow[]): boolean {
  const targets = listReticulumRmapDiscoveryCapable(interfaces);
  return targets.length > 0 && targets.every((row) => row.discoverable === true);
}

/** True when some but not all eligible interfaces are discoverable. */
export function readRmapPublishPartial(interfaces: readonly ReticulumInterfaceRow[]): boolean {
  const targets = listReticulumRmapDiscoveryCapable(interfaces);
  if (targets.length === 0) {
    return false;
  }
  const discoverableCount = targets.filter((row) => row.discoverable === true).length;
  return discoverableCount > 0 && discoverableCount < targets.length;
}

/** LoRa paths that need a TCP transport bridge to reach RMAP (Scenario B). */
export function isReticulumRmapLoRaDiscoveryRow(row: Pick<ReticulumInterfaceRow, 'type'>): boolean {
  const type = row.type.trim().toLowerCase();
  return type === 'rnode' || type === 'kiss' || type === 'ax25kiss';
}

/** Server-style entrypoints that need reachable_on for remote peers (Scenario A). */
export function isReticulumRmapServerDiscoveryRow(
  row: Pick<ReticulumInterfaceRow, 'type'>,
): boolean {
  return row.type.trim().toLowerCase() === 'backbone';
}

export interface RmapUiPrefs {
  announceIntervalMin: number;
  reachableOn: string;
  heightMeters: number | null;
  discoveryLxmfAddress: string;
  discoveryStampValue: number;
  discoveryEncrypt: boolean;
  publishIfac: boolean;
}

export function readRmapUiPrefs(): RmapUiPrefs {
  const parsed = parseStoredJson<Record<string, unknown>>(
    getAppSettingsRaw(),
    'reticulumRmapDiscovery readRmapUiPrefs',
  );
  const announceRaw = parsed?.[RMAP_SETTINGS_KEYS.announceIntervalMin];
  const heightRaw = parsed?.[RMAP_SETTINGS_KEYS.heightMeters];
  const stampRaw = parsed?.[RMAP_SETTINGS_KEYS.discoveryStampValue];
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
    discoveryLxmfAddress:
      typeof parsed?.[RMAP_SETTINGS_KEYS.discoveryLxmfAddress] === 'string'
        ? (parsed[RMAP_SETTINGS_KEYS.discoveryLxmfAddress] as string)
        : '',
    discoveryStampValue:
      stampRaw != null
        ? clampRmapDiscoveryStampValue(Number(stampRaw))
        : RMAP_DISCOVERY_STAMP_DEFAULT,
    discoveryEncrypt:
      parsed?.[RMAP_SETTINGS_KEYS.discoveryEncrypt] === true ||
      parsed?.[RMAP_SETTINGS_KEYS.discoveryEncrypt] === 'true',
    publishIfac:
      parsed?.[RMAP_SETTINGS_KEYS.publishIfac] === true ||
      parsed?.[RMAP_SETTINGS_KEYS.publishIfac] === 'true',
  };
}

export interface RmapPublishStatusSummary {
  publishing: boolean;
  discoverableCount: number;
  publishTargetCount: number;
  needsSyncCount: number;
}

export type RmapPublishCoverageTone = 'off' | 'partial' | 'full';

/** Connection status color tone for X of Y publish coverage. */
export function rmapPublishCoverageTone(
  summary: Pick<RmapPublishStatusSummary, 'discoverableCount' | 'publishTargetCount'>,
): RmapPublishCoverageTone {
  const { discoverableCount: x, publishTargetCount: y } = summary;
  if (x <= 0 || y <= 0) {
    return 'off';
  }
  if (x < y) {
    return 'partial';
  }
  return 'full';
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
  iface: Pick<ReticulumInterfaceRow, 'type' | 'enabled' | 'serial_port' | 'discoverable'> &
    Partial<Pick<ReticulumInterfaceRow, 'id' | 'name'>>,
): boolean {
  return iface.discoverable === true && isReticulumRmapDiscoveryCapable(iface);
}

export function isReticulumRmapNeedsSyncRow(
  iface: Pick<ReticulumInterfaceRow, 'type' | 'enabled' | 'serial_port' | 'discoverable'> &
    Partial<Pick<ReticulumInterfaceRow, 'id' | 'name'>>,
  interfaces: readonly ReticulumInterfaceRow[],
): boolean {
  return (
    readRmapAnyPublishing(interfaces) &&
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
  if (requireRmapReachableOnForServer(iface, reachable)) {
    console.debug('[reticulumRmapDiscovery] sync skipped: backbone needs reachable_on');
    return false;
  }
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
    discoveryLxmfAddress: prefs.discoveryLxmfAddress || null,
    discoveryStampValue: prefs.discoveryStampValue,
    discoveryEncrypt: prefs.discoveryEncrypt,
    publishIfac: prefs.publishIfac,
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
  // Any-publishing intent (including partial X of Y), not Network all-checked.
  if (!readRmapAnyPublishing(interfaces)) {
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
  row: Pick<
    ReticulumInterfaceRow,
    'type' | 'frequency' | 'bandwidth' | 'spreading_factor' | 'coding_rate'
  >,
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
    const type = row.type.trim().toLowerCase();
    if (type === 'i2p') {
      patch.connectable = true;
    }
    const lxmf = opts.discoveryLxmfAddress?.trim() ?? '';
    // Empty string clears a previously stored address (sidecar nonempty_opt_string).
    patch.discovery_lxmf_address = lxmf;
    if (opts.discoveryStampValue != null && Number.isFinite(opts.discoveryStampValue)) {
      patch.discovery_stamp_value = clampRmapDiscoveryStampValue(opts.discoveryStampValue);
    }
    // Always persist explicit booleans so disabling clears a prior Yes in config.
    patch.discovery_encrypt = opts.discoveryEncrypt === true;
    patch.publish_ifac = opts.publishIfac === true;
    // KISS / AX.25 need explicit discovery_* radio params; RNode auto-fills upstream.
    if (type === 'kiss' || type === 'ax25kiss') {
      if (row.frequency != null && Number.isFinite(row.frequency) && row.frequency > 0) {
        patch.discovery_frequency = Math.round(row.frequency);
      }
      if (row.bandwidth != null && Number.isFinite(row.bandwidth) && row.bandwidth > 0) {
        patch.discovery_bandwidth = Math.round(row.bandwidth);
      }
      if (
        row.spreading_factor != null &&
        Number.isFinite(row.spreading_factor) &&
        row.spreading_factor > 0
      ) {
        patch.discovery_spreading_factor = Math.round(row.spreading_factor);
      }
      if (row.coding_rate != null && Number.isFinite(row.coding_rate) && row.coding_rate > 0) {
        patch.discovery_coding_rate = Math.round(row.coding_rate);
      }
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
  discoveryLxmfAddress?: string;
  discoveryStampValue?: number;
  discoveryEncrypt?: boolean;
  publishIfac?: boolean;
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
  const lxmf = (prefs.discoveryLxmfAddress ?? '').trim();
  mergeAppSetting(RMAP_SETTINGS_KEYS.discoveryLxmfAddress, lxmf, 'reticulumRmapDiscovery persist');
  const stamp = clampRmapDiscoveryStampValue(
    prefs.discoveryStampValue ?? RMAP_DISCOVERY_STAMP_DEFAULT,
  );
  mergeAppSetting(RMAP_SETTINGS_KEYS.discoveryStampValue, stamp, 'reticulumRmapDiscovery persist');
  mergeAppSetting(
    RMAP_SETTINGS_KEYS.discoveryEncrypt,
    prefs.discoveryEncrypt === true,
    'reticulumRmapDiscovery persist',
  );
  mergeAppSetting(
    RMAP_SETTINGS_KEYS.publishIfac,
    prefs.publishIfac === true,
    'reticulumRmapDiscovery persist',
  );
  void window.electronAPI.appSettings
    .set(
      RMAP_SETTINGS_KEYS.announceIntervalMin,
      String(clampRmapAnnounceIntervalMin(prefs.announceIntervalMin)),
    )
    .catch((e: unknown) => {
      console.warn('[reticulumRmapDiscovery] persist announceInterval ' + errLikeToLogString(e));
    });
  void window.electronAPI.appSettings
    .set(RMAP_SETTINGS_KEYS.reachableOn, prefs.reachableOn.trim())
    .catch((e: unknown) => {
      console.warn('[reticulumRmapDiscovery] persist reachableOn ' + errLikeToLogString(e));
    });
  if (height) {
    void window.electronAPI.appSettings
      .set(RMAP_SETTINGS_KEYS.heightMeters, height)
      .catch((e: unknown) => {
        console.warn('[reticulumRmapDiscovery] persist heightMeters ' + errLikeToLogString(e));
      });
  }
  void window.electronAPI.appSettings
    .set(RMAP_SETTINGS_KEYS.discoveryLxmfAddress, lxmf)
    .catch((e: unknown) => {
      console.warn('[reticulumRmapDiscovery] persist lxmfAddress ' + errLikeToLogString(e));
    });
  void window.electronAPI.appSettings
    .set(RMAP_SETTINGS_KEYS.discoveryStampValue, String(stamp))
    .catch((e: unknown) => {
      console.warn('[reticulumRmapDiscovery] persist stampValue ' + errLikeToLogString(e));
    });
  void window.electronAPI.appSettings
    .set(RMAP_SETTINGS_KEYS.discoveryEncrypt, prefs.discoveryEncrypt === true ? 'true' : 'false')
    .catch((e: unknown) => {
      console.warn('[reticulumRmapDiscovery] persist encrypt ' + errLikeToLogString(e));
    });
  void window.electronAPI.appSettings
    .set(RMAP_SETTINGS_KEYS.publishIfac, prefs.publishIfac === true ? 'true' : 'false')
    .catch((e: unknown) => {
      console.warn('[reticulumRmapDiscovery] persist publishIfac ' + errLikeToLogString(e));
    });
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
  discoveryLxmfAddress?: string | null;
  discoveryStampValue?: number | null;
  discoveryEncrypt?: boolean | null;
  publishIfac?: boolean | null;
  stackSettings: Pick<
    ReticulumStackSettingsPayload,
    'enable_transport' | 'share_instance' | 'loglevel'
  > &
    Partial<ReticulumStackSettingsPayload>;
}

export interface RmapBatchApplyResult {
  applied: number;
  total: number;
  errors: string[];
}

/** Sidecar merges omitted stack-settings fields atomically — send only the patch. */
async function putReticulumStackSettingsMerged(
  patch: Partial<ReticulumStackSettingsPayload>,
): Promise<void> {
  const res = await patchReticulumStackSettings(patch);
  if (res.ok === false) {
    throw new Error(res.error ?? 'stack_settings_put_failed');
  }
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

  if (targets.some(isReticulumRmapServerDiscoveryRow) && !reachable) {
    throw new ReticulumRmapValidationError('reachable_on_required');
  }

  const lxmf = args.discoveryLxmfAddress?.trim() ?? '';
  if (lxmf) {
    const lxmfErr = validateRmapDiscoveryLxmfAddress(lxmf);
    if (lxmfErr) {
      throw new ReticulumRmapValidationError(`lxmf_${lxmfErr}`);
    }
  }

  const errors: string[] = [];
  let applied = 0;

  const needsTransportBridge = targets.some(isReticulumRmapLoRaDiscoveryRow);
  if (needsTransportBridge && !args.stackSettings.enable_transport) {
    try {
      await putReticulumStackSettingsMerged({
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
        discoveryLxmfAddress: lxmf || null,
        discoveryStampValue: args.discoveryStampValue,
        discoveryEncrypt: args.discoveryEncrypt,
        publishIfac: args.publishIfac,
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
  stackSettings: Pick<
    ReticulumStackSettingsPayload,
    'enable_transport' | 'share_instance' | 'loglevel'
  > &
    Partial<ReticulumStackSettingsPayload>;
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
  const reachableErr = requireRmapReachableOnForServer(iface, reachable);
  if (reachableErr) {
    throw new ReticulumRmapValidationError(
      reachableErr === 'required' ? 'reachable_on_required' : reachableErr,
    );
  }
  if (reachable) {
    const err = validateRmapReachableOn(reachable);
    if (err) {
      throw new ReticulumRmapValidationError(err);
    }
  }

  if (isReticulumRmapLoRaDiscoveryRow(iface)) {
    if (!args.stackSettings.enable_transport) {
      await putReticulumStackSettingsMerged({
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
    discoveryLxmfAddress: prefs.discoveryLxmfAddress || null,
    discoveryStampValue: prefs.discoveryStampValue,
    discoveryEncrypt: prefs.discoveryEncrypt,
    publishIfac: prefs.publishIfac,
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
