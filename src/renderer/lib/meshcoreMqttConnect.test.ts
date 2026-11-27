import { beforeEach, describe, expect, it, vi } from 'vitest';

import { connectEnabledMeshcoreMqttFeeds, prepareMeshcoreMqttConnect } from './meshcoreMqttConnect';
import { MESHCORE_MQTT_DEFAULTS } from './meshcoreMqttDefaults';
import type { MeshcoreMqttFeed } from './meshcoreMqttFeeds';
import type { MQTTSettings } from './types';

const identityMocks = vi.hoisted(() => ({
  readMeshcoreIdentityAsync: vi.fn(),
  meshcoreIdentityHasFullKeyPair: vi.fn(),
  generateLetsMeshAuthToken: vi.fn(),
}));

vi.mock('./letsMeshJwt', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    readMeshcoreIdentityAsync: identityMocks.readMeshcoreIdentityAsync,
    meshcoreIdentityHasFullKeyPair: identityMocks.meshcoreIdentityHasFullKeyPair,
    generateLetsMeshAuthToken: identityMocks.generateLetsMeshAuthToken,
  };
});

const deviceSigningSettings: MQTTSettings = {
  ...MESHCORE_MQTT_DEFAULTS,
  server: 'mqtt.meshmapper.net',
  port: 443,
  username: '',
  password: '',
  topicPrefix: 'meshcore/DEN',
  useWebSocket: true,
  tlsEnabled: true,
  wsPath: '/ws',
};

const customSettings: MQTTSettings = {
  ...MESHCORE_MQTT_DEFAULTS,
  server: 'analyzer.local',
  port: 1883,
  topicPrefix: 'meshcore/den',
  useWebSocket: false,
  tlsEnabled: false,
};

function feed(
  overrides: Partial<MeshcoreMqttFeed> & Pick<MeshcoreMqttFeed, 'id'>,
): MeshcoreMqttFeed {
  return {
    name: overrides.id,
    preset: 'custom',
    settings: customSettings,
    enabled: true,
    ...overrides,
  };
}

describe('prepareMeshcoreMqttConnect', () => {
  beforeEach(() => {
    identityMocks.readMeshcoreIdentityAsync.mockReset();
    identityMocks.meshcoreIdentityHasFullKeyPair.mockReset();
    identityMocks.generateLetsMeshAuthToken.mockReset();
  });

  it('leaves a non-IATA broker prefix untouched', async () => {
    const result = await prepareMeshcoreMqttConnect({
      preset: 'custom',
      settings: customSettings,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.settings.topicPrefix).toBe('meshcore/den');
  });

  it('rejects a malformed IATA prefix', async () => {
    const result = await prepareMeshcoreMqttConnect({
      preset: 'letsmesh',
      settings: { ...deviceSigningSettings, topicPrefix: 'meshcore/usa1' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.errorKey).toBe('connectionPanel.topicPrefixInvalidIata');
  });

  it('needs an identity for a device-signing broker', async () => {
    identityMocks.meshcoreIdentityHasFullKeyPair.mockReturnValue(false);
    identityMocks.readMeshcoreIdentityAsync.mockResolvedValue(null);
    const result = await prepareMeshcoreMqttConnect({
      preset: 'meshmapper',
      settings: deviceSigningSettings,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.errorKey).toBe('connectionPanel.meshcoreMqttIdentity.noIdentity');
    }
  });

  it('mints a JWT from a full identity', async () => {
    identityMocks.meshcoreIdentityHasFullKeyPair.mockReturnValue(true);
    identityMocks.readMeshcoreIdentityAsync.mockResolvedValue({
      private_key: 'priv',
      public_key: 'a'.repeat(64),
    });
    identityMocks.generateLetsMeshAuthToken.mockResolvedValue({
      token: 'jwt-token',
      expiresAt: 1234,
    });
    const result = await prepareMeshcoreMqttConnect({
      preset: 'meshmapper',
      settings: { ...deviceSigningSettings, topicPrefix: 'meshcore/den' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings.topicPrefix).toBe('meshcore/DEN');
      expect(result.settings.username).toMatch(/^v1_/);
      expect(result.settings.password).toBe('jwt-token');
      expect(result.settings.tokenExpiresAt).toBe(1234);
    }
  });
});

describe('connectEnabledMeshcoreMqttFeeds', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.mqtt.connect).mockClear();
  });

  it('connects enabled feeds with their connection id and continues past a failure', async () => {
    const feeds = [
      feed({ id: 'feed-good' }),
      feed({
        id: 'feed-bad',
        preset: 'letsmesh',
        settings: { ...deviceSigningSettings, topicPrefix: 'meshcore/usa1' },
      }),
      feed({ id: 'feed-skipped', enabled: false }),
    ];

    const result = await connectEnabledMeshcoreMqttFeeds(feeds);

    expect(result.connected).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(window.electronAPI.mqtt.connect).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.mqtt.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'feed-good',
        role: 'feed',
        mqttTransportProtocol: 'meshcore',
        topicPrefix: 'meshcore/den',
      }),
    );
  });
});
