import {
  type ManualChannelPublishEntry,
  parseManualChannelPublishEntries,
} from '@/renderer/lib/meshtasticChannelPskInput';
import { loadMeshtasticMqttManualChannelPsksFromStorage } from '@/renderer/lib/meshtasticMqttSettingsStorage';
import { splitChannelPskLine } from '@/shared/meshtasticChannelPskLine';
import {
  isMeshtasticDefaultPublicPsk,
  MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES,
} from '@/shared/meshtasticDefaultPublicPsk';
import { MESHTASTIC_CHANNEL_ROLE } from '@/shared/meshtasticUrlEncoder';

export interface MeshtasticChannelConfigForMqtt {
  index: number;
  name: string;
  role: number;
  psk: Uint8Array;
  uplinkEnabled?: boolean;
  downlinkEnabled?: boolean;
  positionPrecision?: number;
}

export interface MeshtasticMqttPublishFields {
  channelName: string;
  pskBase64: string;
  publishJsonMirror: boolean;
}

export interface MeshtasticMqttOnlyChannelState {
  channels: { index: number; name: string }[];
  channelConfigs: MeshtasticChannelConfigForMqtt[];
}

export interface ResolveMeshtasticMqttPublishOptions {
  /** When true (MQTT-only), prefer Connection panel manual PSK lines over stale BLE channelConfigs. */
  preferManualOverRadio?: boolean;
}

/** MQTT topic channel name: configured name, or LongFast for unnamed primary. Unnamed secondary returns empty (skip MQTT). */
export function resolveMeshtasticMqttChannelName(
  chCfg: MeshtasticChannelConfigForMqtt | undefined,
): string {
  const trimmed = chCfg?.name?.trim();
  if (trimmed) return trimmed;
  if (chCfg?.index === 0) return 'LongFast';
  return '';
}

/** Browser-safe base64 (renderer has no Node Buffer). */
function pskToBase64(psk: Uint8Array): string {
  return btoa(String.fromCharCode(...psk));
}

function decodePskBase64(b64: string): Uint8Array | null {
  try {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    if (raw.length === 16 || raw.length === 32 || raw.length < 16) return raw;
    return null;
  } catch {
    // catch-no-log-ok invalid base64 on a manual PSK line — skip entry
    return null;
  }
}

/** Bare base64 manual lines (decrypt-only in main) used for LongFast publish when channel 0 has no named entry. */
function firstBareManualPsk(lines: string[]): Uint8Array | undefined {
  for (const line of lines) {
    const split = splitChannelPskLine(line);
    if (split?.kind === 'bare') {
      const psk = decodePskBase64(split.b64);
      if (psk && isNonTrivialMeshtasticChannelPsk(psk)) return psk;
    }
  }
  return undefined;
}

function resolveManualPublishFields(
  channelIndex: number,
  entries: ManualChannelPublishEntry[],
  radioName: string,
  manualLines: string[],
): MeshtasticMqttPublishFields | null {
  const byIndex = entries.find((e) => e.index === channelIndex);
  if (byIndex) return manualEntryToPublishFields(byIndex);

  const expectedName = radioName || (channelIndex === 0 ? 'LongFast' : '');
  if (expectedName) {
    const byName = entries.find((e) => e.name === expectedName && e.index === undefined);
    if (byName) return manualEntryToPublishFields(byName);
  }

  if (channelIndex === 0) {
    const bare = firstBareManualPsk(manualLines);
    if (bare) {
      return {
        channelName: 'LongFast',
        pskBase64: pskToBase64(bare),
        publishJsonMirror: isMeshtasticDefaultPublicPsk(bare),
      };
    }
  }

  return null;
}

export function isNonTrivialMeshtasticChannelPsk(psk: Uint8Array): boolean {
  if (psk.length === 0) return false;
  if (psk.length === 1 && psk[0] === 0) return false;
  if (psk.length === 1 && psk[0] === 1) return false;
  return true;
}

/** Manual Connection panel channel PSK lines for MQTT-only publish fallback. */
export function loadMeshtasticMqttManualChannelPsks(): string[] {
  return loadMeshtasticMqttManualChannelPsksFromStorage();
}

/** Build chat channel tabs and configs from Connection panel manual PSK lines (MQTT-only). */
export function buildMeshtasticMqttOnlyChannelState(
  manualLines?: string[],
): MeshtasticMqttOnlyChannelState {
  const lines = manualLines ?? loadMeshtasticMqttManualChannelPsks();
  const entries = parseManualChannelPublishEntries(lines);
  const channels: { index: number; name: string }[] = [];
  const channelConfigs: MeshtasticChannelConfigForMqtt[] = [];

  const usedIndices = new Set<number>();
  for (const entry of entries) {
    let index = entry.index;
    index ??= entry.name === 'LongFast' ? 0 : undefined;
    if (index === undefined) {
      for (let i = 1; i <= 7; i++) {
        if (!usedIndices.has(i)) {
          index = i;
          break;
        }
      }
    }
    if (index === undefined || index > 7 || usedIndices.has(index)) continue;
    usedIndices.add(index);
    const role = index === 0 ? MESHTASTIC_CHANNEL_ROLE.PRIMARY : MESHTASTIC_CHANNEL_ROLE.SECONDARY;
    const label = entry.name || (index === 0 ? 'LongFast' : `Ch ${index}`);
    channels.push({ index, name: label });
    channelConfigs.push({
      index,
      name: entry.name,
      role,
      psk: entry.psk,
      uplinkEnabled: true,
      downlinkEnabled: true,
      positionPrecision: 0,
    });
  }

  const barePsk = channels.length === 0 ? firstBareManualPsk(lines) : undefined;
  if (barePsk) {
    channels.push({ index: 0, name: 'LongFast' });
    channelConfigs.push({
      index: 0,
      name: 'LongFast',
      role: MESHTASTIC_CHANNEL_ROLE.PRIMARY,
      psk: barePsk,
      uplinkEnabled: true,
      downlinkEnabled: true,
      positionPrecision: 0,
    });
  }

  channels.sort((a, b) => a.index - b.index);
  channelConfigs.sort((a, b) => a.index - b.index);
  return { channels, channelConfigs };
}

/** Channel name, PSK, and JSON mirror flag for Meshtastic MQTT publish IPC. */
export function meshtasticMqttPublishFields(
  chCfg: MeshtasticChannelConfigForMqtt | undefined,
  fallbackPsk?: Uint8Array,
): MeshtasticMqttPublishFields {
  const psk =
    chCfg?.psk && isNonTrivialMeshtasticChannelPsk(chCfg.psk)
      ? chCfg.psk
      : (fallbackPsk ?? MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES);
  return {
    channelName: resolveMeshtasticMqttChannelName(chCfg),
    pskBase64: pskToBase64(psk),
    publishJsonMirror: isMeshtasticDefaultPublicPsk(psk),
  };
}

function manualEntryToPublishFields(entry: {
  name: string;
  psk: Uint8Array;
}): MeshtasticMqttPublishFields {
  return {
    channelName: entry.name,
    pskBase64: pskToBase64(entry.psk),
    publishJsonMirror: isMeshtasticDefaultPublicPsk(entry.psk),
  };
}

/** Resolve publish fields from radio config, falling back to Connection panel manual PSK lines. */
export function resolveMeshtasticMqttPublishFieldsForChannel(
  channelIndex: number,
  channelConfigs: MeshtasticChannelConfigForMqtt[],
  manualLines?: string[],
  options?: ResolveMeshtasticMqttPublishOptions,
): MeshtasticMqttPublishFields {
  const lines = manualLines ?? loadMeshtasticMqttManualChannelPsks();
  const entries = parseManualChannelPublishEntries(lines);
  const chCfg = channelConfigs.find((c) => c.index === channelIndex);
  const radioName = resolveMeshtasticMqttChannelName(chCfg);

  if (options?.preferManualOverRadio) {
    const manual = resolveManualPublishFields(channelIndex, entries, radioName, lines);
    if (manual) return manual;
    if (chCfg && isNonTrivialMeshtasticChannelPsk(chCfg.psk) && radioName) {
      return meshtasticMqttPublishFields(chCfg);
    }
    return meshtasticMqttPublishFields(chCfg, firstBareManualPsk(lines));
  }

  if (chCfg && isNonTrivialMeshtasticChannelPsk(chCfg.psk) && radioName) {
    return meshtasticMqttPublishFields(chCfg);
  }

  const manual = resolveManualPublishFields(channelIndex, entries, radioName, lines);
  if (manual) return manual;

  return meshtasticMqttPublishFields(chCfg, firstBareManualPsk(lines));
}

/** Entries for mqtt.updateChannelKeys from radio channel configs. */
export function meshtasticMqttChannelKeyEntries(
  channelConfigs: MeshtasticChannelConfigForMqtt[],
): { name: string; pskBase64: string; index: number }[] {
  const entries: { name: string; pskBase64: string; index: number }[] = [];
  for (const ch of channelConfigs) {
    if (ch.role === MESHTASTIC_CHANNEL_ROLE.DISABLED) continue;
    const name = resolveMeshtasticMqttChannelName(ch);
    if (!name) continue;
    if (!isNonTrivialMeshtasticChannelPsk(ch.psk)) continue;
    entries.push({ name, pskBase64: pskToBase64(ch.psk), index: ch.index });
  }
  return entries;
}

/** Manual PSK lines as mqtt.updateChannelKeys entries when radio configs are empty. */
export function meshtasticMqttChannelKeyEntriesFromManual(
  manualLines?: string[],
): { name: string; pskBase64: string; index: number }[] {
  const { channelConfigs } = buildMeshtasticMqttOnlyChannelState(manualLines);
  return meshtasticMqttChannelKeyEntries(channelConfigs);
}
