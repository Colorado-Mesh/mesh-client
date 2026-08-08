import { isLetsMeshSettings } from './letsMeshJwt';
import { DEVICE_SIGNING_MESHCORE_PRESETS, type MeshcoreMqttPreset } from './meshcoreMqttPresets';
import type { MQTTSettings } from './types';

/** i18n key used when an IATA-scoped MeshCore topic prefix is malformed. */
export const MESHCORE_TOPIC_PREFIX_INVALID_IATA_KEY = 'connectionPanel.topicPrefixInvalidIata';

export interface MeshcoreIataTopicPrefixParseOk {
  ok: true;
  normalized: string;
  segment: string;
}

export interface MeshcoreIataTopicPrefixParseErr {
  ok: false;
  errorKey: typeof MESHCORE_TOPIC_PREFIX_INVALID_IATA_KEY;
}

export type MeshcoreIataTopicPrefixParseResult =
  MeshcoreIataTopicPrefixParseOk | MeshcoreIataTopicPrefixParseErr;

/** Presets / device-signing hosts that expect `meshcore/{IATA}` or `meshcore/test`. */
export function isIataScopedMeshcoreMqtt(
  preset: MeshcoreMqttPreset | null | undefined,
  settings: Pick<MQTTSettings, 'server'> | null | undefined,
): boolean {
  if (preset && DEVICE_SIGNING_MESHCORE_PRESETS.has(preset)) return true;
  const server = settings?.server.trim() ?? '';
  return server.length > 0 && isLetsMeshSettings(server);
}

/**
 * Parse and normalize an IATA-scoped MeshCore topic prefix.
 * Accepts `meshcore/test` or `meshcore/{AAA}` (3 letters); uppercases airport codes.
 */
export function parseMeshcoreIataTopicPrefix(prefix: string): MeshcoreIataTopicPrefixParseResult {
  if (prefix.includes('+') || prefix.includes('#')) {
    return { ok: false, errorKey: MESHCORE_TOPIC_PREFIX_INVALID_IATA_KEY };
  }
  let p = prefix.trim();
  if (p.endsWith('/')) p = p.slice(0, -1);
  const match = /^meshcore\/([^/]+)$/i.exec(p);
  if (!match) {
    return { ok: false, errorKey: MESHCORE_TOPIC_PREFIX_INVALID_IATA_KEY };
  }
  const rawSegment = match[1];
  if (rawSegment.toLowerCase() === 'test') {
    return { ok: true, normalized: 'meshcore/test', segment: 'test' };
  }
  if (/^[A-Za-z]{3}$/.test(rawSegment)) {
    const segment = rawSegment.toUpperCase();
    return { ok: true, normalized: `meshcore/${segment}`, segment };
  }
  return { ok: false, errorKey: MESHCORE_TOPIC_PREFIX_INVALID_IATA_KEY };
}

/** Normalize when valid; return null when invalid. */
export function normalizeMeshcoreIataTopicPrefix(prefix: string): string | null {
  const parsed = parseMeshcoreIataTopicPrefix(prefix);
  return parsed.ok ? parsed.normalized : null;
}

/** True when IATA-scoped config has a valid topic prefix. */
export function isValidMeshcoreIataTopicPrefix(
  preset: MeshcoreMqttPreset | null | undefined,
  settings: Pick<MQTTSettings, 'server' | 'topicPrefix'>,
): boolean {
  if (!isIataScopedMeshcoreMqtt(preset, settings)) return true;
  return parseMeshcoreIataTopicPrefix(settings.topicPrefix).ok;
}

export type PrepareMeshcoreIataMqttResult =
  | { ok: true; topicPrefix: string; changed: boolean }
  | { ok: false; errorKey: typeof MESHCORE_TOPIC_PREFIX_INVALID_IATA_KEY };

/**
 * Shared validate/normalize for IATA-scoped MeshCore MQTT (manual connect + auto-launch).
 * Non-IATA brokers pass through unchanged.
 */
export function prepareMeshcoreIataMqttTopicPrefix(
  preset: MeshcoreMqttPreset | null | undefined,
  settings: Pick<MQTTSettings, 'server' | 'topicPrefix'>,
): PrepareMeshcoreIataMqttResult {
  if (!isIataScopedMeshcoreMqtt(preset, settings)) {
    return { ok: true, topicPrefix: settings.topicPrefix, changed: false };
  }
  const parsed = parseMeshcoreIataTopicPrefix(settings.topicPrefix);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    topicPrefix: parsed.normalized,
    changed: parsed.normalized !== settings.topicPrefix,
  };
}
