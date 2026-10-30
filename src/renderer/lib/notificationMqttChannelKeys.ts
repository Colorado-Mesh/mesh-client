import { computeChannelIdentityKey } from '@/shared/channelIdentityKey';
import { splitChannelPskLine } from '@/shared/meshtasticChannelPskLine';
import {
  expandMeshtasticPskAlias,
  MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES,
  normalizeMeshtasticPskTo16Bytes,
} from '@/shared/meshtasticDefaultPublicPsk';

import {
  buildMeshtasticMqttOnlyChannelState,
  loadMeshtasticMqttManualChannelPsks,
} from './meshtasticMqttPublish';

/** MQTT has canonical manual/default channel settings even before RF discovers channels. */
export function notificationMqttChannelKeys(
  lines = loadMeshtasticMqttManualChannelPsks(),
): Readonly<Record<number, string>> {
  const keys: Record<number, string> = {};
  for (const channel of buildMeshtasticMqttOnlyChannelState(lines).channelConfigs) {
    const psk =
      channel.psk.length === 1
        ? expandMeshtasticPskAlias(channel.psk[0])
        : channel.psk.length < 16
          ? normalizeMeshtasticPskTo16Bytes(channel.psk)
          : channel.psk;
    if (!psk) continue;
    keys[channel.index] = computeChannelIdentityKey('meshtastic', channel.name, psk);
  }
  // The publish parser intentionally omits default shorthand entries. Their
  // firmware alias and explicit slot still define a notification identity.
  for (const line of lines) {
    const trimmed = line.trim();
    // A padded one-byte alias can otherwise look like a short named entry.
    const entry = /^[A-Za-z0-9+/]{2}==$/.test(trimmed)
      ? { kind: 'bare' as const, b64: trimmed }
      : splitChannelPskLine(line);
    if (!entry) continue;
    const index =
      entry.kind === 'bare' ? 0 : (entry.index ?? (entry.name === 'LongFast' ? 0 : undefined));
    if (index == null || keys[index]) continue;
    try {
      const raw = Uint8Array.from(atob(entry.b64), (character) => character.charCodeAt(0));
      const psk = raw.length === 1 ? expandMeshtasticPskAlias(raw[0]) : null;
      if (psk)
        keys[index] = computeChannelIdentityKey(
          'meshtastic',
          entry.kind === 'bare' ? 'LongFast' : entry.name,
          psk,
        );
    } catch {
      // catch-no-log-ok malformed settings have no stable channel identity; the bell save fails visibly
    }
  }
  // Existing MQTT publish defaults to the standard public LongFast channel.
  if (lines.length === 0) {
    keys[0] = computeChannelIdentityKey(
      'meshtastic',
      'LongFast',
      MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES,
    );
  }
  return keys;
}
