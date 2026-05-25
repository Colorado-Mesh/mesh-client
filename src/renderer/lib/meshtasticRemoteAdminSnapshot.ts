import { Admin } from '@meshtastic/protobufs';

import type { MeshtasticLoraConfig } from '@/shared/meshtasticUrlEncoder';

import { errLikeToLogString } from './errLikeToLogString';
import {
  delayMs,
  type MeshtasticRemoteAdminClient,
  normalizeRemoteAdminError,
  REMOTE_ADMIN_CHANNEL_FETCH_DELAY_MS,
  REMOTE_ADMIN_CHANNEL_LOOP_START_DELAY_MS,
  REMOTE_ADMIN_CHANNEL_MAX_ATTEMPTS,
  REMOTE_ADMIN_CHANNEL_RETRY_BACKOFF_MS,
  REMOTE_ADMIN_CONFIG_FETCH_DELAY_MS,
  REMOTE_ADMIN_ESSENTIAL_FETCH_DELAY_MS,
  REMOTE_ADMIN_LORA_CONFIG_MAX_ATTEMPTS,
  REMOTE_ADMIN_LORA_CONFIG_RETRY_BACKOFF_MS,
} from './meshtasticRemoteAdmin';
import type { MeshtasticRemoteConfigSnapshot } from './types';

const MODULE_CONFIG_FETCHES: {
  type: (typeof Admin.AdminMessage_ModuleConfigType)[keyof typeof Admin.AdminMessage_ModuleConfigType];
  key: string;
}[] = [
  { type: Admin.AdminMessage_ModuleConfigType.MQTT_CONFIG, key: 'mqtt' },
  { type: Admin.AdminMessage_ModuleConfigType.SERIAL_CONFIG, key: 'serial' },
  { type: Admin.AdminMessage_ModuleConfigType.EXTNOTIF_CONFIG, key: 'externalNotification' },
  { type: Admin.AdminMessage_ModuleConfigType.STOREFORWARD_CONFIG, key: 'storeForward' },
  { type: Admin.AdminMessage_ModuleConfigType.RANGETEST_CONFIG, key: 'rangeTest' },
  { type: Admin.AdminMessage_ModuleConfigType.TELEMETRY_CONFIG, key: 'telemetry' },
  { type: Admin.AdminMessage_ModuleConfigType.CANNEDMSG_CONFIG, key: 'cannedMessage' },
  { type: Admin.AdminMessage_ModuleConfigType.AUDIO_CONFIG, key: 'audio' },
  { type: Admin.AdminMessage_ModuleConfigType.REMOTEHARDWARE_CONFIG, key: 'remoteHardware' },
  { type: Admin.AdminMessage_ModuleConfigType.NEIGHBORINFO_CONFIG, key: 'neighborInfo' },
  { type: Admin.AdminMessage_ModuleConfigType.AMBIENTLIGHTING_CONFIG, key: 'ambientLighting' },
  { type: Admin.AdminMessage_ModuleConfigType.DETECTIONSENSOR_CONFIG, key: 'detectionSensor' },
  { type: Admin.AdminMessage_ModuleConfigType.PAXCOUNTER_CONFIG, key: 'paxcounter' },
];

const DEFERRED_CONFIG_TYPES = [
  Admin.AdminMessage_ConfigType.POSITION_CONFIG,
  Admin.AdminMessage_ConfigType.POWER_CONFIG,
  Admin.AdminMessage_ConfigType.NETWORK_CONFIG,
  Admin.AdminMessage_ConfigType.DISPLAY_CONFIG,
  Admin.AdminMessage_ConfigType.BLUETOOTH_CONFIG,
  Admin.AdminMessage_ConfigType.TELEMETRY_CONFIG,
] as const;

function configPayloadCase(value: unknown): string | undefined {
  const cfg = value as { payloadVariant?: { case?: string; value?: unknown } };
  return cfg.payloadVariant?.case;
}

function configPayloadValue(value: unknown): unknown {
  const cfg = value as { payloadVariant?: { case?: string; value?: unknown } };
  return cfg.payloadVariant?.value;
}

function moduleConfigKeyFromResponse(value: unknown): string | undefined {
  const cfg = value as { payloadVariant?: { case?: string } };
  const rawCase = cfg.payloadVariant?.case;
  if (!rawCase) return undefined;
  if (rawCase === 'external_notification') return 'externalNotification';
  if (rawCase === 'store_forward') return 'storeForward';
  if (rawCase === 'range_test') return 'rangeTest';
  if (rawCase === 'canned_message') return 'cannedMessage';
  if (rawCase === 'remote_hardware') return 'remoteHardware';
  if (rawCase === 'neighbor_info') return 'neighborInfo';
  if (rawCase === 'ambient_lighting') return 'ambientLighting';
  if (rawCase === 'detection_sensor') return 'detectionSensor';
  return rawCase;
}

function parseChannelEntry(channel: unknown, index: number) {
  const ch = channel as {
    index?: number;
    role?: number;
    settings?: {
      name?: string;
      psk?: Uint8Array;
      uplinkEnabled?: boolean;
      downlinkEnabled?: boolean;
      positionPrecision?: number;
    };
  };
  const settings = ch.settings;
  return {
    index: ch.index ?? index,
    name: settings?.name ?? '',
    role: ch.role ?? 0,
    psk: settings?.psk ?? new Uint8Array(),
    uplinkEnabled: settings?.uplinkEnabled ?? false,
    downlinkEnabled: settings?.downlinkEnabled ?? false,
    positionPrecision: settings?.positionPrecision ?? 0,
  };
}

function isChannelEntryEmpty(entry: ReturnType<typeof parseChannelEntry>): boolean {
  return entry.role === 0 && entry.name.length === 0 && entry.psk.length === 0;
}

function parseSecurityConfig(value: unknown): MeshtasticRemoteConfigSnapshot['securityConfig'] {
  const sec = configPayloadValue(value) as {
    publicKey?: Uint8Array;
    privateKey?: Uint8Array;
    adminKey?: Uint8Array[];
    isManaged?: boolean;
    serialEnabled?: boolean;
    debugLogApiEnabled?: boolean;
    adminChannelEnabled?: boolean;
  } | null;
  if (!sec) return null;
  return {
    publicKey: sec.publicKey ?? new Uint8Array(),
    ...(sec.privateKey && sec.privateKey.length > 0 ? { privateKey: sec.privateKey } : {}),
    adminKey: sec.adminKey ?? [],
    isManaged: sec.isManaged ?? false,
    serialEnabled: sec.serialEnabled ?? false,
    debugLogApiEnabled: sec.debugLogApiEnabled ?? false,
    adminChannelEnabled: sec.adminChannelEnabled ?? false,
  };
}

function parseOwner(value: unknown): MeshtasticRemoteConfigSnapshot['deviceOwner'] {
  const owner = value as { longName?: string; shortName?: string; isLicensed?: boolean };
  if (!owner.longName && !owner.shortName) return null;
  return {
    longName: owner.longName ?? '',
    shortName: owner.shortName ?? '',
    isLicensed: owner.isLicensed ?? false,
  };
}

function applyConfigResultsToSnapshot(
  snapshot: Partial<MeshtasticRemoteConfigSnapshot>,
  configResults: { value: unknown }[],
): void {
  for (const { value } of configResults) {
    if (value == null) continue;
    const caseName = configPayloadCase(value);
    const payload = configPayloadValue(value);
    if (caseName === 'lora') {
      snapshot.loraConfig = payload as MeshtasticLoraConfig;
    } else if (caseName === 'security') {
      snapshot.securityConfig = parseSecurityConfig(value);
    } else if (caseName === 'position') {
      const pos = payload as { fixedPosition?: boolean; gpsMode?: number } | undefined;
      if (pos) {
        snapshot.deviceFixedPosition = pos.fixedPosition ?? null;
        snapshot.deviceGpsMode = pos.gpsMode ?? null;
      }
    } else if (caseName === 'telemetry') {
      const tel = payload as {
        deviceUpdateInterval?: number;
        device_update_interval?: number;
      };
      const interval = tel.deviceUpdateInterval ?? tel.device_update_interval;
      if (typeof interval === 'number') {
        snapshot.telemetryDeviceUpdateInterval = interval;
      }
    }
  }
}

async function ensureRemoteSessionKey(
  client: MeshtasticRemoteAdminClient,
  destNodeNum: number,
): Promise<void> {
  try {
    await client.ensureSessionKey(destNodeNum);
  } catch (e) {
    console.warn(
      '[fetchMeshtasticRemoteConfigSnapshot] ensureSessionKey failed ' + errLikeToLogString(e),
    );
    // Failure point: session key exchange over BLE. Fallback: continue — getRemoteConfig may
    // still succeed with an existing passkey or trigger a fresh session on the next request.
  }
}

async function fetchConfigTypes(
  client: MeshtasticRemoteAdminClient,
  destNodeNum: number,
  configTypes: readonly (typeof Admin.AdminMessage_ConfigType)[keyof typeof Admin.AdminMessage_ConfigType][],
  interFetchDelayMs: number,
  options?: { continueOnNonLoraFailure?: boolean },
): Promise<{
  configResults: { type: (typeof configTypes)[number]; value: unknown }[];
  loraConfigFetchFailed: boolean;
  loraConfigFetchError: string | undefined;
}> {
  const configResults: { type: (typeof configTypes)[number]; value: unknown }[] = [];
  let loraConfigFetchFailed = false;
  let loraConfigFetchError: string | undefined;

  for (let i = 0; i < configTypes.length; i++) {
    const type = configTypes[i]!;
    if (i > 0 && interFetchDelayMs > 0) {
      await delayMs(interFetchDelayMs);
    }

    if (type === Admin.AdminMessage_ConfigType.LORA_CONFIG) {
      try {
        const value = await client.getRemoteConfigWithRetry(destNodeNum, type, {
          maxAttempts: REMOTE_ADMIN_LORA_CONFIG_MAX_ATTEMPTS,
          backoffMs: REMOTE_ADMIN_LORA_CONFIG_RETRY_BACKOFF_MS,
        });
        configResults.push({ type, value });
      } catch (e) {
        loraConfigFetchFailed = true;
        loraConfigFetchError = normalizeRemoteAdminError(e);
        console.warn(
          '[fetchMeshtasticRemoteConfigSnapshot] LoRa config fetch failed ' + errLikeToLogString(e),
        );
        configResults.push({ type, value: null });
      }
      continue;
    }

    if (options?.continueOnNonLoraFailure) {
      try {
        const value = await client.getRemoteConfig(destNodeNum, type);
        configResults.push({ type, value });
      } catch (e) {
        console.warn(
          '[fetchMeshtasticRemoteConfigSnapshot] config fetch failed type=' +
            String(type) +
            ' ' +
            errLikeToLogString(e),
        );
        configResults.push({ type, value: null });
      }
      continue;
    }

    configResults.push({ type, value: await client.getRemoteConfig(destNodeNum, type) });
  }

  return { configResults, loraConfigFetchFailed, loraConfigFetchError };
}

async function fetchRemoteChannelIndex(
  client: MeshtasticRemoteAdminClient,
  destNodeNum: number,
  index: number,
): Promise<unknown> {
  return client.getRemoteChannelWithRetry(destNodeNum, index, {
    maxAttempts: REMOTE_ADMIN_CHANNEL_MAX_ATTEMPTS,
    backoffMs: REMOTE_ADMIN_CHANNEL_RETRY_BACKOFF_MS,
  });
}

async function fetchRemoteChannels(
  client: MeshtasticRemoteAdminClient,
  destNodeNum: number,
  interFetchDelayMs: number,
  options?: { startIndex?: number; loopStartDelayMs?: number },
): Promise<{
  channelResults: { index: number; value: unknown }[];
  failedChannelIndices: number[];
}> {
  const channelResults: { index: number; value: unknown }[] = [];
  const failedChannelIndices: number[] = [];
  const startIndex = options?.startIndex ?? 0;
  const loopStartDelayMs = options?.loopStartDelayMs ?? 0;

  if (startIndex > 0 && loopStartDelayMs > 0) {
    await delayMs(loopStartDelayMs);
  }

  for (let index = startIndex; index < 8; index++) {
    if (index > startIndex && interFetchDelayMs > 0) {
      await delayMs(interFetchDelayMs);
    }
    try {
      const value = await fetchRemoteChannelIndex(client, destNodeNum, index);
      channelResults.push({ index, value });
      const parsed = parseChannelEntry(value, index);
      if (index >= 1 && isChannelEntryEmpty(parsed)) {
        break;
      }
    } catch (e) {
      failedChannelIndices.push(index);
      console.warn(
        '[fetchMeshtasticRemoteConfigSnapshot] channel fetch failed index=' +
          String(index) +
          ' ' +
          errLikeToLogString(e),
      );
      channelResults.push({ index, value: null });
    }
  }

  return { channelResults, failedChannelIndices };
}

function channelFetchFlags(failedChannelIndices: number[]): {
  channelConfigFetchFailed: boolean;
  primaryChannelConfigFetchFailed: boolean;
} {
  return {
    channelConfigFetchFailed: failedChannelIndices.length > 0,
    primaryChannelConfigFetchFailed: failedChannelIndices.includes(0),
  };
}

function channelConfigsFromResults(
  channelResults: { index: number; value: unknown }[],
): MeshtasticRemoteConfigSnapshot['channelConfigs'] {
  return channelResults
    .filter(({ value }) => value != null)
    .map(({ index, value }) => parseChannelEntry(value, index))
    .filter((ch) => ch.role !== 0 || ch.name.length > 0 || ch.psk.length > 0);
}

export async function fetchMeshtasticRemoteConfigTarget(
  client: MeshtasticRemoteAdminClient,
  destNodeNum: number,
): Promise<MeshtasticRemoteConfigSnapshot> {
  const metadata = await client.getRemoteMetadata(destNodeNum);
  await ensureRemoteSessionKey(client, destNodeNum);

  return {
    metadata,
    moduleConfigs: {},
  };
}

/** Channels route: fetch channel 0 + LoRa only, matching Android's initial Channels load. */
export async function fetchMeshtasticRemoteConfigSnapshotEssential(
  client: MeshtasticRemoteAdminClient,
  destNodeNum: number,
): Promise<MeshtasticRemoteConfigSnapshot> {
  const snapshot: MeshtasticRemoteConfigSnapshot = { moduleConfigs: {} };
  const primaryChannelResults: { index: number; value: unknown }[] = [];
  const failedChannelIndices: number[] = [];
  try {
    const value = await fetchRemoteChannelIndex(client, destNodeNum, 0);
    primaryChannelResults.push({ index: 0, value });
  } catch (e) {
    failedChannelIndices.push(0);
    console.warn(
      '[fetchMeshtasticRemoteConfigSnapshot] channel fetch failed index=0 ' + errLikeToLogString(e),
    );
    primaryChannelResults.push({ index: 0, value: null });
  }

  const { configResults, loraConfigFetchFailed, loraConfigFetchError } = await fetchConfigTypes(
    client,
    destNodeNum,
    [Admin.AdminMessage_ConfigType.LORA_CONFIG],
    REMOTE_ADMIN_ESSENTIAL_FETCH_DELAY_MS,
  );
  const channelFlags = channelFetchFlags(failedChannelIndices);

  applyConfigResultsToSnapshot(snapshot, configResults);
  snapshot.loraConfigFetchFailed = loraConfigFetchFailed;
  snapshot.loraConfigFetchError = loraConfigFetchError;
  snapshot.channelConfigFetchFailed = channelFlags.channelConfigFetchFailed;
  snapshot.primaryChannelConfigFetchFailed = channelFlags.primaryChannelConfigFetchFailed;
  snapshot.failedChannelIndices = failedChannelIndices;
  snapshot.channelConfigs = channelConfigsFromResults(primaryChannelResults);

  return snapshot;
}

export async function fetchMeshtasticRemoteConfigChannelsTail(
  client: MeshtasticRemoteAdminClient,
  destNodeNum: number,
): Promise<Partial<MeshtasticRemoteConfigSnapshot>> {
  const { channelResults, failedChannelIndices } = await fetchRemoteChannels(
    client,
    destNodeNum,
    REMOTE_ADMIN_CHANNEL_FETCH_DELAY_MS,
    {
      startIndex: 1,
      loopStartDelayMs: REMOTE_ADMIN_CHANNEL_LOOP_START_DELAY_MS,
    },
  );
  return {
    ...channelFetchFlags(failedChannelIndices),
    failedChannelIndices,
    channelConfigs: channelConfigsFromResults(channelResults),
  };
}

export async function fetchMeshtasticRemoteConfigSecurity(
  client: MeshtasticRemoteAdminClient,
  destNodeNum: number,
): Promise<Partial<MeshtasticRemoteConfigSnapshot>> {
  const value = await client.getRemoteConfig(
    destNodeNum,
    Admin.AdminMessage_ConfigType.SECURITY_CONFIG,
  );
  const partial: Partial<MeshtasticRemoteConfigSnapshot> = {};
  applyConfigResultsToSnapshot(partial, [{ value }]);
  return partial;
}

export async function fetchMeshtasticRemoteConfigOwner(
  client: MeshtasticRemoteAdminClient,
  destNodeNum: number,
): Promise<Partial<MeshtasticRemoteConfigSnapshot>> {
  return {
    deviceOwner: parseOwner(await client.getRemoteOwner(destNodeNum)),
  };
}

export async function fetchMeshtasticRemoteConfigModules(
  client: MeshtasticRemoteAdminClient,
  destNodeNum: number,
): Promise<Partial<MeshtasticRemoteConfigSnapshot>> {
  const moduleResults: { key: string; value: unknown }[] = [];
  for (const { type, key } of MODULE_CONFIG_FETCHES) {
    try {
      const value = await client.getRemoteModuleConfig(destNodeNum, type);
      moduleResults.push({ key, value });
    } catch {
      // catch-no-log-ok optional module config may be unsupported on target firmware
      moduleResults.push({ key, value: null });
    }
  }

  const moduleConfigs: Record<string, unknown> = {};
  for (const { key, value } of moduleResults) {
    if (value == null) continue;
    const modKey = moduleConfigKeyFromResponse(value) ?? key;
    const modVal = configPayloadValue(value);
    if (modVal != null) {
      moduleConfigs[modKey] = modVal;
    }
  }
  return { moduleConfigs };
}

/** Deferred core configs only; callers opt into module/owner routes explicitly. */
export async function fetchMeshtasticRemoteConfigSnapshotDeferred(
  client: MeshtasticRemoteAdminClient,
  destNodeNum: number,
): Promise<Partial<MeshtasticRemoteConfigSnapshot>> {
  const { configResults } = await fetchConfigTypes(
    client,
    destNodeNum,
    DEFERRED_CONFIG_TYPES,
    REMOTE_ADMIN_CONFIG_FETCH_DELAY_MS,
    { continueOnNonLoraFailure: true },
  );

  const partial: Partial<MeshtasticRemoteConfigSnapshot> = {};
  applyConfigResultsToSnapshot(partial, configResults);
  return partial;
}

export function mergeMeshtasticRemoteConfigSnapshots(
  base: MeshtasticRemoteConfigSnapshot,
  deferred: Partial<MeshtasticRemoteConfigSnapshot>,
): MeshtasticRemoteConfigSnapshot {
  const mergedChannelConfigs =
    deferred.channelConfigs == null
      ? base.channelConfigs
      : [...(base.channelConfigs ?? []), ...deferred.channelConfigs].filter(
          (ch, index, all) => all.findIndex((candidate) => candidate.index === ch.index) === index,
        );

  return {
    ...base,
    ...deferred,
    loraConfigFetchFailed:
      (base.loraConfigFetchFailed ?? false) || (deferred.loraConfigFetchFailed ?? false),
    channelConfigFetchFailed:
      (base.channelConfigFetchFailed ?? false) || (deferred.channelConfigFetchFailed ?? false),
    primaryChannelConfigFetchFailed:
      (base.primaryChannelConfigFetchFailed ?? false) ||
      (deferred.primaryChannelConfigFetchFailed ?? false),
    failedChannelIndices:
      base.failedChannelIndices != null || deferred.failedChannelIndices != null
        ? Array.from(
            new Set([
              ...(base.failedChannelIndices ?? []),
              ...(deferred.failedChannelIndices ?? []),
            ]),
          )
        : undefined,
    moduleConfigs: {
      ...base.moduleConfigs,
      ...deferred.moduleConfigs,
    },
    channelConfigs: mergedChannelConfigs,
  };
}

/** Full snapshot (essential + deferred) for manual refresh. */
export async function fetchMeshtasticRemoteConfigSnapshot(
  client: MeshtasticRemoteAdminClient,
  destNodeNum: number,
): Promise<MeshtasticRemoteConfigSnapshot> {
  const target = await fetchMeshtasticRemoteConfigTarget(client, destNodeNum);
  const essential = mergeMeshtasticRemoteConfigSnapshots(
    target,
    await fetchMeshtasticRemoteConfigSnapshotEssential(client, destNodeNum),
  );
  const channels = await fetchMeshtasticRemoteConfigChannelsTail(client, destNodeNum);
  const security = await fetchMeshtasticRemoteConfigSecurity(client, destNodeNum);
  const owner = await fetchMeshtasticRemoteConfigOwner(client, destNodeNum);
  const modules = await fetchMeshtasticRemoteConfigModules(client, destNodeNum);
  const deferred = await fetchMeshtasticRemoteConfigSnapshotDeferred(client, destNodeNum);
  return [channels, security, owner, modules, deferred].reduce(
    (snapshot, partial) => mergeMeshtasticRemoteConfigSnapshots(snapshot, partial),
    essential,
  );
}
