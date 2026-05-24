import { parseManualChannelPublishEntries } from '@/renderer/lib/meshtasticChannelPskInput';
import { parseStoredJson } from '@/renderer/lib/parseStoredJson';
import { isMeshtasticDefaultPublicPsk } from '@/shared/meshtasticDefaultPublicPsk';
import { MESHTASTIC_CHANNEL_ROLE } from '@/shared/meshtasticUrlEncoder';

export interface MeshtasticChannelConfigForMqtt {
  index: number;
  name: string;
  role: number;
  psk: Uint8Array;
}

export interface MeshtasticMqttPublishFields {
  channelName: string;
  pskBase64: string;
  publishJsonMirror: boolean;
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

export function isNonTrivialMeshtasticChannelPsk(psk: Uint8Array): boolean {
  if (psk.length === 0) return false;
  if (psk.length === 1 && psk[0] === 0) return false;
  if (psk.length === 1 && psk[0] === 1) return false;
  return true;
}

/** Manual Connection panel channel PSK lines for MQTT-only publish fallback. */
export function loadMeshtasticMqttManualChannelPsks(): string[] {
  const raw = localStorage.getItem('mesh-client:mqttSettings');
  const parsed = parseStoredJson<{ channelPsks?: string[] }>(
    raw,
    'loadMeshtasticMqttManualChannelPsks',
  );
  return parsed?.channelPsks ?? [];
}

/** Channel name, PSK, and JSON mirror flag for Meshtastic MQTT publish IPC. */
export function meshtasticMqttPublishFields(
  chCfg: MeshtasticChannelConfigForMqtt | undefined,
): MeshtasticMqttPublishFields {
  return {
    channelName: resolveMeshtasticMqttChannelName(chCfg),
    pskBase64: pskToBase64(chCfg?.psk ?? new Uint8Array([1])),
    publishJsonMirror: chCfg ? isMeshtasticDefaultPublicPsk(chCfg.psk) : false,
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
): MeshtasticMqttPublishFields {
  const chCfg = channelConfigs.find((c) => c.index === channelIndex);
  const radioName = resolveMeshtasticMqttChannelName(chCfg);
  if (chCfg && isNonTrivialMeshtasticChannelPsk(chCfg.psk) && radioName) {
    return meshtasticMqttPublishFields(chCfg);
  }

  const entries = parseManualChannelPublishEntries(manualLines ?? []);
  const byIndex = entries.find((e) => e.index === channelIndex);
  if (byIndex) return manualEntryToPublishFields(byIndex);

  const expectedName = radioName || (channelIndex === 0 ? 'LongFast' : '');
  if (expectedName) {
    const byName = entries.find((e) => e.name === expectedName && e.index === undefined);
    if (byName) return manualEntryToPublishFields(byName);
  }

  return meshtasticMqttPublishFields(chCfg);
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
    const isTrivial = ch.psk.length === 0 || (ch.psk.length === 1 && ch.psk[0] === 0);
    if (isTrivial) continue;
    entries.push({ name, pskBase64: pskToBase64(ch.psk), index: ch.index });
  }
  return entries;
}
