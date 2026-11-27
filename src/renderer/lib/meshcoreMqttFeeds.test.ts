import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_MESHCORE_MQTT_ENABLED_PUBLISH_FEEDS,
  MAX_MESHCORE_MQTT_PUBLISH_FEEDS,
} from '@/shared/meshcoreMqttConnections';

import { MESHCORE_MQTT_DEFAULTS } from './meshcoreMqttDefaults';
import {
  canEnableMeshcoreMqttFeed,
  createMeshcoreMqttFeed,
  deleteMeshcoreMqttFeed,
  flushMeshcoreMqttFeedsSave,
  loadMeshcoreMqttFeeds,
  MESHCORE_MQTT_FEEDS_SECRET_KEY,
  MESHCORE_MQTT_FEEDS_STORAGE_KEY,
  meshcoreFeedOverrideWarning,
  type MeshcoreMqttFeed,
  meshcorePacketTopic,
  persistMeshcoreMqttFeeds,
  updateMeshcoreMqttFeed,
} from './meshcoreMqttFeeds';
import { getCachedSecureSecret, resetSecureSecretCacheForTests } from './secureSecretStorage';
import type { MQTTSettings } from './types';

const baseSettings: MQTTSettings = {
  ...MESHCORE_MQTT_DEFAULTS,
  server: 'mqtt.meshmapper.net',
  port: 443,
  username: '',
  password: 'secret-token',
  topicPrefix: 'meshcore/DEN',
  useWebSocket: true,
  tlsEnabled: true,
  wsPath: '/ws',
};

function makeFeed(
  name: string,
  overrides: Partial<MeshcoreMqttFeed> = {},
  id?: string,
): MeshcoreMqttFeed {
  const feed = createMeshcoreMqttFeed({
    name,
    preset: 'meshmapper',
    settings: { ...baseSettings, ...overrides.settings },
    id,
  });
  if (!feed) throw new Error('feed not created');
  return { ...feed, ...overrides };
}

describe('meshcoreMqttFeeds', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSecureSecretCacheForTests();
    vi.mocked(window.electronAPI.secureSecrets.set).mockClear();
  });

  it('round-trips feeds without leaking the password into localStorage', async () => {
    const feeds = [
      makeFeed('MeshMapper', {}, 'feed-a'),
      makeFeed(
        'Local analyzer',
        { settings: { ...baseSettings, server: 'analyzer.local' } },
        'feed-b',
      ),
    ];
    void persistMeshcoreMqttFeeds(feeds);
    await flushMeshcoreMqttFeedsSave();

    const raw = localStorage.getItem(MESHCORE_MQTT_FEEDS_STORAGE_KEY) ?? '';
    expect(raw).not.toContain('secret-token');
    expect(getCachedSecureSecret(MESHCORE_MQTT_FEEDS_SECRET_KEY)).toContain('secret-token');

    const loaded = loadMeshcoreMqttFeeds();
    expect(loaded.map((f) => f.name)).toEqual(['MeshMapper', 'Local analyzer']);
    expect(loaded[0].settings.password).toBe('secret-token');
    expect(loaded[0].settings.meshcorePacketLoggerEnabled).toBe(true);
    expect(loaded[0].enabled).toBe(false);
  });

  it('drops invalid rows and caps the saved list', async () => {
    const feeds: MeshcoreMqttFeed[] = [];
    for (let i = 0; i < MAX_MESHCORE_MQTT_PUBLISH_FEEDS + 3; i += 1) {
      feeds.push(makeFeed(`Feed ${i}`, { enabled: false }, `feed-${i}`));
    }
    await persistMeshcoreMqttFeeds(feeds);
    expect(loadMeshcoreMqttFeeds()).toHaveLength(MAX_MESHCORE_MQTT_PUBLISH_FEEDS);

    localStorage.setItem(
      MESHCORE_MQTT_FEEDS_STORAGE_KEY,
      JSON.stringify({ version: 1, feeds: [{ id: 'x', name: 'bad' }] }),
    );
    expect(loadMeshcoreMqttFeeds()).toEqual([]);
  });

  it('bounds how many feeds may hold a socket', () => {
    const enabled = Array.from({ length: MAX_MESHCORE_MQTT_ENABLED_PUBLISH_FEEDS }, (_, i) =>
      makeFeed(`Feed ${i}`, { enabled: true }, `feed-${i}`),
    );
    expect(canEnableMeshcoreMqttFeed(enabled)).toBe(false);
    expect(canEnableMeshcoreMqttFeed(enabled.slice(1))).toBe(true);
  });

  it('renames, updates and deletes by id', () => {
    let feeds = [makeFeed('One', {}, 'a'), makeFeed('Two', {}, 'b')];
    // Raw draft text is preserved so spaces type naturally; the panel trims on blur.
    feeds = updateMeshcoreMqttFeed(feeds, 'a', { name: '  Renamed  ' });
    expect(feeds[0].name).toBe('  Renamed  ');
    // A blank draft is allowed while the name field is being edited.
    feeds = updateMeshcoreMqttFeed(feeds, 'a', { name: '   ' });
    expect(feeds[0].name).toBe('   ');
    feeds = deleteMeshcoreMqttFeed(feeds, 'a');
    expect(feeds.map((f) => f.id)).toEqual(['b']);
  });

  it('warns only when feeds target the same broker', () => {
    const feedA = makeFeed('A', { enabled: true }, 'a');
    const sameBroker = makeFeed(
      'B',
      {
        enabled: true,
        settings: { ...baseSettings, username: 'other', topicPrefix: 'meshcore/SEA' },
      },
      'b',
    );
    const sameTopicDifferentBroker = makeFeed(
      'C',
      { enabled: true, settings: { ...baseSettings, server: 'analyzer.local' } },
      'c',
    );
    expect(meshcoreFeedOverrideWarning([feedA], sameBroker)).toBe(true);
    // Same topic prefix on a different broker is the intended analyzer fan-out.
    expect(meshcoreFeedOverrideWarning([feedA], sameTopicDifferentBroker)).toBe(false);
    expect(meshcoreFeedOverrideWarning([feedA], { ...sameBroker, enabled: false })).toBe(false);
  });

  it('builds the analyzer topic from the prefix and v1 pubkey', () => {
    expect(meshcorePacketTopic({ topicPrefix: 'meshcore/DEN', username: '' })).toBe(
      'meshcore/DEN/meshcore/packets',
    );
    const pubKey = 'a'.repeat(64);
    expect(meshcorePacketTopic({ topicPrefix: 'meshcore/DEN', username: `v1_${pubKey}` })).toBe(
      `meshcore/DEN/${pubKey.toUpperCase()}/packets`,
    );
  });
});
