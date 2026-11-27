import {
  MAX_MESHCORE_MQTT_ENABLED_PUBLISH_FEEDS,
  MAX_MESHCORE_MQTT_PUBLISH_FEEDS,
} from '@/shared/meshcoreMqttConnections';

import { errLikeToLogString } from './errLikeToLogString';
import { MESHCORE_MQTT_DEFAULTS } from './meshcoreMqttDefaults';
import type { MeshcoreMqttPreset } from './meshcoreMqttPresets';
import { parseStoredJson } from './parseStoredJson';
import {
  getCachedSecureSecret,
  MESHCORE_MQTT_FEEDS_SECRET_KEY,
  removeSecureSecret,
  setSecureSecret,
} from './secureSecretStorage';

export { MESHCORE_MQTT_FEEDS_SECRET_KEY };
import type { MQTTSettings } from './types';

export const MESHCORE_MQTT_FEEDS_STORAGE_KEY = 'mesh-client:mqttFeeds:meshcore';
export const MESHCORE_MQTT_FEED_NAME_MAX_LENGTH = 60;

/** Publish-only packet-analyzer broker. The bidirectional chat broker stays in MQTT settings. */
export interface MeshcoreMqttFeed {
  id: string;
  name: string;
  preset: MeshcoreMqttPreset;
  settings: MQTTSettings;
  enabled: boolean;
}

interface StoredMeshcoreMqttFeed {
  id: string;
  name: string;
  preset: MeshcoreMqttPreset;
  settings: Omit<MQTTSettings, 'password'>;
  enabled: boolean;
}

interface MeshcoreMqttFeedsDocument {
  version: 1;
  /** User-visible chat-broker name; blank means the localized default label. */
  chatName?: string;
  feeds: StoredMeshcoreMqttFeed[];
}

const FEEDS_DOCUMENT_VERSION = 1;
const KNOWN_PRESETS = new Set<MeshcoreMqttPreset>([
  'letsmesh',
  'coloradomesh',
  'meshmapper',
  'waev',
  'meshatse',
  'meshcoreca',
  'eastmesh',
  'ripple',
  'custom',
]);

let pendingSave: Promise<void> | null = null;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function normalizeFeedName(name: string): string {
  return name.trim().slice(0, MESHCORE_MQTT_FEED_NAME_MAX_LENGTH);
}

function readStoredDocument(): MeshcoreMqttFeedsDocument | null {
  const parsed = parseStoredJson<unknown>(
    localStorage.getItem(MESHCORE_MQTT_FEEDS_STORAGE_KEY),
    'loadMeshcoreMqttFeeds',
  );
  if (!isRecord(parsed) || !Array.isArray(parsed.feeds)) return null;
  return {
    version: FEEDS_DOCUMENT_VERSION,
    chatName: typeof parsed.chatName === 'string' ? parsed.chatName : undefined,
    feeds: parsed.feeds as StoredMeshcoreMqttFeed[],
  };
}

/** User-editable name for the chat broker (blank falls back to the localized label). */
export function loadMeshcoreMqttChatName(): string {
  return readStoredDocument()?.chatName ?? '';
}

function normalizeChatName(name: string): string {
  return name.trim().slice(0, MESHCORE_MQTT_FEED_NAME_MAX_LENGTH);
}

function isStoredFeed(v: unknown): v is StoredMeshcoreMqttFeed {
  if (!isRecord(v)) return false;
  if (typeof v.id !== 'string' || v.id.length === 0 || v.id.length > 64) return false;
  if (typeof v.name !== 'string') return false;
  if (typeof v.enabled !== 'boolean') return false;
  if (typeof v.preset !== 'string' || !KNOWN_PRESETS.has(v.preset as MeshcoreMqttPreset)) {
    return false;
  }
  if (!isRecord(v.settings)) return false;
  const s = v.settings;
  return (
    typeof s.server === 'string' &&
    typeof s.port === 'number' &&
    Number.isInteger(s.port) &&
    typeof s.topicPrefix === 'string' &&
    (s.username === undefined || typeof s.username === 'string')
  );
}

function mergeFeedSettings(stored: Omit<MQTTSettings, 'password'>, password: string): MQTTSettings {
  return { ...MESHCORE_MQTT_DEFAULTS, ...stored, password };
}

/** Feeds with their saved credentials merged in. Missing/invalid rows are dropped. */
export function loadMeshcoreMqttFeeds(): MeshcoreMqttFeed[] {
  try {
    const doc = readStoredDocument();
    if (!doc) return [];
    const secrets =
      parseStoredJson<Record<string, { password?: string } | undefined>>(
        getCachedSecureSecret(MESHCORE_MQTT_FEEDS_SECRET_KEY),
        'loadMeshcoreMqttFeeds secrets',
      ) ?? {};
    return doc.feeds
      .filter(isStoredFeed)
      .slice(0, MAX_MESHCORE_MQTT_PUBLISH_FEEDS)
      .map((feed) => ({
        ...feed,
        settings: mergeFeedSettings(feed.settings, secrets[feed.id]?.password ?? ''),
      }));
  } catch (e) {
    console.debug('[meshcoreMqttFeeds] load failed ' + errLikeToLogString(e));
    return [];
  }
}

function toStored(feed: MeshcoreMqttFeed): StoredMeshcoreMqttFeed {
  const settings: Partial<MQTTSettings> = { ...feed.settings };
  delete settings.password;
  return { ...feed, settings: settings as Omit<MQTTSettings, 'password'> };
}

async function saveSecretsNow(feeds: readonly MeshcoreMqttFeed[]): Promise<void> {
  const limited = feeds.slice(0, MAX_MESHCORE_MQTT_PUBLISH_FEEDS);
  const passwords: Record<string, { password: string }> = {};
  for (const feed of limited) passwords[feed.id] = { password: feed.settings.password };
  if (limited.length === 0) await removeSecureSecret(MESHCORE_MQTT_FEEDS_SECRET_KEY);
  else await setSecureSecret(MESHCORE_MQTT_FEEDS_SECRET_KEY, JSON.stringify(passwords));
}

/**
 * Persist non-secret metadata synchronously and credentials via the secure service.
 * Omit `chatName` to keep the stored chat-broker name unchanged.
 */
export function persistMeshcoreMqttFeeds(
  feeds: readonly MeshcoreMqttFeed[],
  chatName?: string,
): void {
  const limited = feeds.slice(0, MAX_MESHCORE_MQTT_PUBLISH_FEEDS);
  const storedChatName =
    chatName === undefined ? readStoredDocument()?.chatName : normalizeChatName(chatName);
  localStorage.setItem(
    MESHCORE_MQTT_FEEDS_STORAGE_KEY,
    JSON.stringify({
      version: FEEDS_DOCUMENT_VERSION,
      ...(storedChatName ? { chatName: storedChatName } : {}),
      feeds: limited.map(toStored),
    } satisfies MeshcoreMqttFeedsDocument),
  );
  const previous = pendingSave ?? Promise.resolve();
  pendingSave = previous
    .catch(() => undefined)
    .then(() => saveSecretsNow(limited))
    .catch((e: unknown) => {
      console.warn(
        'mcL1509 [meshcoreMqttFeeds] credential persist failed ' + errLikeToLogString(e),
      );
    })
    .finally(() => {
      pendingSave = null;
    });
}

/** Resolves once the latest credential write settles (tests / shutdown). */
export async function flushMeshcoreMqttFeedsSave(): Promise<void> {
  await pendingSave;
}

/** Enabled feeds are bounded because each one holds a live socket. */
export function canEnableMeshcoreMqttFeed(feeds: readonly MeshcoreMqttFeed[]): boolean {
  return feeds.filter((feed) => feed.enabled).length < MAX_MESHCORE_MQTT_ENABLED_PUBLISH_FEEDS;
}

export function createMeshcoreMqttFeed(args: {
  name: string;
  preset: MeshcoreMqttPreset;
  settings: MQTTSettings;
  id?: string;
}): MeshcoreMqttFeed | null {
  const name = normalizeFeedName(args.name);
  if (!name) return null;
  return {
    id: args.id ?? crypto.randomUUID(),
    name,
    preset: args.preset,
    settings: { ...args.settings, meshcorePacketLoggerEnabled: true, autoLaunch: false },
    enabled: false,
  };
}

export function updateMeshcoreMqttFeed(
  feeds: readonly MeshcoreMqttFeed[],
  id: string,
  patch: Partial<Pick<MeshcoreMqttFeed, 'name' | 'preset' | 'settings' | 'enabled'>>,
): MeshcoreMqttFeed[] {
  return feeds.map((feed) => {
    if (feed.id !== id) return feed;
    // Keep raw input (including trailing spaces) while the user is typing; trim on blur.
    const name =
      patch.name !== undefined
        ? patch.name.slice(0, MESHCORE_MQTT_FEED_NAME_MAX_LENGTH)
        : feed.name;
    return { ...feed, ...patch, name };
  });
}

export function deleteMeshcoreMqttFeed(
  feeds: readonly MeshcoreMqttFeed[],
  id: string,
): MeshcoreMqttFeed[] {
  return feeds.filter((feed) => feed.id !== id);
}

/** Packet-analyzer topic an adapter publishes to (used to warn on duplicate feeds). */
export function meshcorePacketTopic(
  settings: Pick<MQTTSettings, 'topicPrefix' | 'username'>,
): string {
  const base = (settings.topicPrefix || 'msh').replace(/\/$/, '');
  const pubKey = /^v1_([0-9a-f]{64})$/i.exec(settings.username)?.[1]?.toUpperCase();
  return pubKey ? `${base}/${pubKey}/packets` : `${base}/meshcore/packets`;
}

/** Two enabled feeds on the same broker/topic would publish identical packets twice. */
export function meshcoreFeedOverrideWarning(
  feeds: readonly MeshcoreMqttFeed[],
  candidate: Pick<MeshcoreMqttFeed, 'id' | 'enabled' | 'settings'>,
): boolean {
  if (!candidate.enabled) return false;
  const topic = meshcorePacketTopic(candidate.settings);
  return feeds.some(
    (feed) =>
      feed.id !== candidate.id &&
      feed.enabled &&
      (meshcorePacketTopic(feed.settings) === topic ||
        (feed.settings.server.trim().toLowerCase() ===
          candidate.settings.server.trim().toLowerCase() &&
          feed.settings.port === candidate.settings.port)),
  );
}
