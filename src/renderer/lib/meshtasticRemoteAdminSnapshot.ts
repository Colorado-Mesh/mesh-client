import { Admin } from '@meshtastic/protobufs';

import type { MeshtasticLoraConfig } from '@/shared/meshtasticUrlEncoder';

import type { MeshtasticRemoteAdminClient } from './meshtasticRemoteAdmin';
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

export async function fetchMeshtasticRemoteConfigSnapshot(
  client: MeshtasticRemoteAdminClient,
  destNodeNum: number,
): Promise<MeshtasticRemoteConfigSnapshot> {
  const metadata = await client.getRemoteMetadata(destNodeNum);

  const configTypes = [
    Admin.AdminMessage_ConfigType.DEVICE_CONFIG,
    Admin.AdminMessage_ConfigType.LORA_CONFIG,
    Admin.AdminMessage_ConfigType.POSITION_CONFIG,
    Admin.AdminMessage_ConfigType.POWER_CONFIG,
    Admin.AdminMessage_ConfigType.NETWORK_CONFIG,
    Admin.AdminMessage_ConfigType.DISPLAY_CONFIG,
    Admin.AdminMessage_ConfigType.BLUETOOTH_CONFIG,
    Admin.AdminMessage_ConfigType.SECURITY_CONFIG,
    Admin.AdminMessage_ConfigType.TELEMETRY_CONFIG,
  ] as const;

  const configResults: { type: (typeof configTypes)[number]; value: unknown }[] = [];
  for (const type of configTypes) {
    configResults.push({ type, value: await client.getRemoteConfig(destNodeNum, type) });
  }

  const channelResults: { index: number; value: unknown }[] = [];
  for (let index = 0; index < 8; index++) {
    channelResults.push({ index, value: await client.getRemoteChannel(destNodeNum, index) });
  }

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

  let deviceOwner: MeshtasticRemoteConfigSnapshot['deviceOwner'];
  try {
    deviceOwner = parseOwner(await client.getRemoteOwner(destNodeNum));
  } catch {
    // catch-no-log-ok owner fetch is optional for remote admin snapshot
    deviceOwner = null;
  }

  const snapshot: MeshtasticRemoteConfigSnapshot = { metadata };

  for (const { value } of configResults) {
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

  snapshot.channelConfigs = channelResults
    .map(({ index, value }) => parseChannelEntry(value, index))
    .filter((ch) => ch.role !== 0 || ch.name.length > 0 || ch.psk.length > 0);

  const moduleConfigs: Record<string, unknown> = {};
  for (const { key, value } of moduleResults) {
    if (value == null) continue;
    const modKey = moduleConfigKeyFromResponse(value) ?? key;
    const modVal = configPayloadValue(value);
    if (modVal != null) {
      moduleConfigs[modKey] = modVal;
    }
  }
  snapshot.moduleConfigs = moduleConfigs;
  snapshot.deviceOwner = deviceOwner;

  return snapshot;
}
