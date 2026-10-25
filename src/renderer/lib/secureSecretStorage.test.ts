import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX,
  MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX,
} from '@/shared/appSettingsKeyPrefixes';

import { APP_SETTINGS_STORAGE_KEY, LEGACY_APP_SETTINGS_STORAGE_KEY } from './appSettingsStorage';
import {
  forgetUnavailableStartupCredentials,
  getCachedSecureSecret,
  getUnavailableStartupCredentialKeys,
  initializeSecureSecrets,
  initializeSecureSecretsFailClosed,
  isProtectedSecureSecretUnavailable,
  keyBackupSecretKey,
  MESHCORE_IDENTITY_SECRET_KEY,
  MESHCORE_MQTT_SECRET_KEY,
  meshcoreRepeaterSecretKey,
  meshcoreRoomSecretKey,
  MESHTASTIC_MQTT_SECRET_KEY,
  MQTT_PROFILES_SECRET_KEY,
  removeSecureSecret,
  resetSecureSecretCacheForTests,
  secureSecretsInitialized,
  setSecureSecret,
} from './secureSecretStorage';

const secureValues = new Map<string, string>();
const appSettingsValues = new Map<string, string>();

const inlineCredentialSources = [
  {
    name: 'identity',
    storageKey: 'mesh-client:meshcoreIdentity',
    secretKey: MESHCORE_IDENTITY_SECRET_KEY,
    raw: JSON.stringify({ public_key: 'public-key', private_key: Array(32).fill(7) }, null, 2),
    metadata: { public_key: 'public-key' },
    secret: JSON.stringify(Array(32).fill(7)),
  },
  {
    name: 'MeshCore MQTT',
    storageKey: 'mesh-client:mqttSettings:meshcore',
    secretKey: MESHCORE_MQTT_SECRET_KEY,
    raw: JSON.stringify(
      { server: 'broker', password: 'inline-password', channelPsks: [] },
      null,
      2,
    ),
    metadata: { server: 'broker' },
    secret: JSON.stringify({ password: 'inline-password', channelPsks: [] }),
  },
  {
    name: 'Meshtastic MQTT',
    storageKey: 'mesh-client:mqttSettings',
    secretKey: MESHTASTIC_MQTT_SECRET_KEY,
    raw: JSON.stringify(
      { server: 'broker', password: 'inline-password', channelPsks: [] },
      null,
      2,
    ),
    metadata: { server: 'broker' },
    secret: JSON.stringify({ password: 'inline-password', channelPsks: [] }),
  },
  {
    name: 'MQTT profiles',
    storageKey: 'mesh-client:mqttProfiles:meshtastic',
    secretKey: MQTT_PROFILES_SECRET_KEY,
    raw: JSON.stringify([{ id: 'saved', server: 'broker', password: 'inline-password' }], null, 2),
    metadata: [{ id: 'saved', server: 'broker' }],
    secret: JSON.stringify({ saved: 'inline-password' }),
  },
  {
    name: 'room',
    storageKey: APP_SETTINGS_STORAGE_KEY,
    secretKey: meshcoreRoomSecretKey(42),
    raw: JSON.stringify(
      { theme: 'dark', [`${MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX}42`]: 'inline-password' },
      null,
      2,
    ),
    metadata: { theme: 'dark' },
    secret: 'inline-password',
  },
  {
    name: 'repeater alias',
    storageKey: LEGACY_APP_SETTINGS_STORAGE_KEY,
    secretKey: meshcoreRepeaterSecretKey(43),
    raw: JSON.stringify(
      { theme: 'dark', [`${MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX}43`]: 'inline-password' },
      null,
      2,
    ),
    metadata: { theme: 'dark' },
    secret: 'inline-password',
  },
];

function installSecureSecretApi(): void {
  window.electronAPI.secureSecrets = {
    status: vi.fn().mockResolvedValue({ available: true, persistent: true }),
    list: vi.fn(() => Promise.resolve([...secureValues.keys()])),
    getAll: vi.fn(() => Promise.resolve(Object.fromEntries(secureValues))),
    get: vi.fn((key: string) => Promise.resolve(secureValues.get(key) ?? null)),
    set: vi.fn((key: string, value: string) => {
      secureValues.set(key, value);
      return Promise.resolve({ available: true, persistent: true, verified: true });
    }),
    remove: vi.fn((key: string) => {
      secureValues.delete(key);
      return Promise.resolve();
    }),
    migrateLegacyIdentityCiphertext: vi.fn((ciphertext: string) => {
      const decoded = Buffer.from(ciphertext, 'base64')
        .toString('utf8')
        .replace(/^protected:/, '');
      secureValues.set(MESHCORE_IDENTITY_SECRET_KEY, decoded);
      return Promise.resolve({ available: true, persistent: true, verified: true });
    }),
    migrateLegacyBackupCiphertext: vi.fn(
      (
        protocol: 'meshcore' | 'meshtastic',
        id: number,
        _format: 'per-node' | 'meshtastic-single',
        ciphertext: string,
      ) => {
        const decoded = Buffer.from(ciphertext, 'base64')
          .toString('utf8')
          .replace(/^protected:/, '');
        const key = keyBackupSecretKey(protocol, id);
        const existing = secureValues.get(key);
        if (existing != null) {
          const existingPayload = JSON.parse(existing) as {
            publicKey?: unknown;
            privateKey?: unknown;
          };
          const candidatePayload = JSON.parse(decoded) as {
            publicKey?: unknown;
            privateKey?: unknown;
          };
          if (
            existingPayload.publicKey !== candidatePayload.publicKey ||
            existingPayload.privateKey !== candidatePayload.privateKey
          ) {
            return Promise.reject(new Error('secureSecrets: conflicting legacy backup'));
          }
        } else {
          secureValues.set(key, decoded);
        }
        return Promise.resolve({ available: true, persistent: true, verified: true });
      },
    ),
  };
  window.electronAPI.appSettings.getAll = vi.fn(() =>
    Promise.resolve(Object.fromEntries(appSettingsValues)),
  );
  window.electronAPI.appSettings.set = vi.fn((key: string, value: string) => {
    appSettingsValues.set(key, value);
    return Promise.resolve({ changes: 1 });
  });
  window.electronAPI.appSettings.remove = vi.fn((key: string) => {
    const changes = appSettingsValues.delete(key) ? 1 : 0;
    return Promise.resolve({ changes });
  });
}

describe('secureSecretStorage migrations', () => {
  beforeEach(() => {
    localStorage.clear();
    secureValues.clear();
    appSettingsValues.clear();
    resetSecureSecretCacheForTests();
    installSecureSecretApi();
  });

  it('rebuilds both missing backup indexes from surviving keys before any device panel opens', async () => {
    for (const protocol of ['meshcore', 'meshtastic'] as const) {
      const id = protocol === 'meshcore' ? 41 : 42;
      secureValues.set(
        keyBackupSecretKey(protocol, id),
        JSON.stringify({
          protocol,
          [protocol === 'meshcore' ? 'nodeId' : 'nodeNum']: id,
          publicKey: Buffer.alloc(32, 1).toString('base64'),
          privateKey: Buffer.alloc(protocol === 'meshcore' ? 64 : 32, 2).toString('base64'),
          backedUpAt: 12345,
          nodeLabel: `Saved ${protocol}`,
        }),
      );
      localStorage.setItem(
        `mesh-client:${protocol === 'meshcore' ? 'meshcore-key' : 'meshtastic-dm-key'}-backup-index`,
        '',
      );
    }
    await initializeSecureSecrets();
    const { listMeshcoreKeyBackups } = await import('./meshcoreKeyBackupStorage');
    const { listMeshtasticDmKeyBackups } = await import('./meshtasticDmKeyBackupStorage');
    expect(listMeshcoreKeyBackups()).toMatchObject([{ nodeId: 41, nodeLabel: 'Saved meshcore' }]);
    expect(listMeshtasticDmKeyBackups()).toMatchObject([
      { nodeNum: 42, nodeLabel: 'Saved meshtastic' },
    ]);
    expect(secureValues.has('backup:meshcore:41')).toBe(true);
    expect(secureValues.has('backup:meshtastic:42')).toBe(true);
  });

  it('remembers credentials through keyring outages and removes compatibility copies after encryption', async () => {
    vi.mocked(window.electronAPI.secureSecrets.status).mockResolvedValue({
      available: false,
      persistent: false,
    });
    vi.mocked(window.electronAPI.secureSecrets.set).mockResolvedValue({
      available: false,
      persistent: false,
      verified: true,
    });
    await setSecureSecret(MESHCORE_MQTT_SECRET_KEY, '{"password":"remember-me"}');
    secureValues.set(MESHCORE_MQTT_SECRET_KEY, '{"password":"older-protected-value"}');
    resetSecureSecretCacheForTests();
    vi.mocked(window.electronAPI.secureSecrets.set).mockClear();
    await initializeSecureSecrets();
    expect(getCachedSecureSecret(MESHCORE_MQTT_SECRET_KEY)).toBe('{"password":"remember-me"}');
    expect(window.electronAPI.secureSecrets.set).not.toHaveBeenCalled();

    installSecureSecretApi();
    resetSecureSecretCacheForTests();
    await initializeSecureSecrets();
    expect(secureValues.get(MESHCORE_MQTT_SECRET_KEY)).toBe('{"password":"remember-me"}');
    expect(localStorage.getItem('mesh-client:credentialCompatibility:mqtt:meshcore')).toBeNull();
  });

  it('encrypts an equal main-process session value before retiring its compatibility copy after keyring recovery', async () => {
    const value = '{"password":"session-backed"}';
    vi.mocked(window.electronAPI.secureSecrets.set).mockResolvedValueOnce({
      available: false,
      persistent: false,
      verified: true,
    });
    await setSecureSecret(MESHCORE_MQTT_SECRET_KEY, value);
    // The running main process returns session secrets through getAll, even after recovery.
    secureValues.set(MESHCORE_MQTT_SECRET_KEY, value);
    resetSecureSecretCacheForTests();
    vi.mocked(window.electronAPI.secureSecrets.set).mockClear();
    await initializeSecureSecrets();
    expect(window.electronAPI.secureSecrets.set).toHaveBeenCalledWith(
      MESHCORE_MQTT_SECRET_KEY,
      value,
      true,
    );
    expect(localStorage.getItem('mesh-client:credentialCompatibility:mqtt:meshcore')).toBeNull();
  });

  it.each([
    JSON.stringify('unversioned-old-value'),
    JSON.stringify(null),
    JSON.stringify({ value: 'unacknowledged-old-value', id: 'pending', origin: 'file:' }),
  ])(
    'preserves an unreadable native row and unacknowledged compatibility source %s',
    async (raw) => {
      const compatibilityKey = `mesh-client:credentialCompatibility:${MESHCORE_MQTT_SECRET_KEY}`;
      secureValues.set(MESHCORE_MQTT_SECRET_KEY, 'protected-current');
      localStorage.setItem(compatibilityKey, raw);
      vi.mocked(window.electronAPI.secureSecrets.getAll).mockResolvedValue({});

      await expect(initializeSecureSecretsFailClosed()).rejects.toThrow(
        /protected credential unavailable/,
      );

      expect(secureValues.get(MESHCORE_MQTT_SECRET_KEY)).toBe('protected-current');
      expect(localStorage.getItem(compatibilityKey)).toBe(raw);
      expect(window.electronAPI.secureSecrets.set).not.toHaveBeenCalled();
      expect(window.electronAPI.secureSecrets.remove).not.toHaveBeenCalled();
      expect(getCachedSecureSecret(MESHCORE_MQTT_SECRET_KEY)).toBeNull();
      expect(getUnavailableStartupCredentialKeys()).toEqual([MESHCORE_MQTT_SECRET_KEY]);
    },
  );

  it.each([false, true])(
    'preserves receipt-authorized newer compatibility edit precedence over an unreadable row with persistent=%s',
    async (persistent) => {
      const value = JSON.stringify({ password: 'newer-explicit-edit' });
      vi.mocked(window.electronAPI.secureSecrets.set).mockResolvedValueOnce({
        available: false,
        persistent: false,
        verified: true,
      });
      await setSecureSecret(MESHCORE_MQTT_SECRET_KEY, value);
      secureValues.set(
        MESHCORE_MQTT_SECRET_KEY,
        JSON.stringify({ password: 'older-protected-value' }),
      );
      resetSecureSecretCacheForTests();
      vi.mocked(window.electronAPI.secureSecrets.status).mockResolvedValue({
        available: persistent,
        persistent,
      });
      vi.mocked(window.electronAPI.secureSecrets.getAll).mockResolvedValue({});
      vi.mocked(window.electronAPI.secureSecrets.set).mockClear();

      await initializeSecureSecretsFailClosed();

      expect(getCachedSecureSecret(MESHCORE_MQTT_SECRET_KEY)).toBe(value);
      if (persistent) {
        expect(window.electronAPI.secureSecrets.set).toHaveBeenCalledWith(
          MESHCORE_MQTT_SECRET_KEY,
          value,
          true,
        );
        expect(secureValues.get(MESHCORE_MQTT_SECRET_KEY)).toBe(value);
      } else {
        expect(window.electronAPI.secureSecrets.set).not.toHaveBeenCalled();
      }
    },
  );

  it('retries legacy cross-protocol PSKs after an unreadable keyring launch', async () => {
    secureValues.set(
      MESHCORE_MQTT_SECRET_KEY,
      JSON.stringify({ channelPsks: ['Saved=AAAAAAAAAAAAAAAAAAAAAA=='] }),
    );
    vi.mocked(window.electronAPI.secureSecrets.status).mockResolvedValue({
      available: false,
      persistent: false,
    });
    vi.mocked(window.electronAPI.secureSecrets.getAll).mockResolvedValue({});
    await initializeSecureSecrets();
    expect(localStorage.getItem('mesh-client:migrated:meshtastic-psk-recovery-v1')).toBeNull();
    installSecureSecretApi();
    resetSecureSecretCacheForTests();
    await initializeSecureSecrets();
    expect(
      JSON.parse(getCachedSecureSecret(MESHTASTIC_MQTT_SECRET_KEY) ?? '{}').channelPsks,
    ).toEqual(['Saved=AAAAAAAAAAAAAAAAAAAAAA==']);
  });

  it('hydrates large compatibility collections without replaying writes while the keyring is unavailable', async () => {
    vi.mocked(window.electronAPI.secureSecrets.status).mockResolvedValue({
      available: false,
      persistent: false,
    });
    for (let id = 0; id < 130; id += 1) {
      localStorage.setItem(
        `mesh-client:credentialCompatibility:${meshcoreRoomSecretKey(id)}`,
        JSON.stringify(`credential-${id}`),
      );
    }
    await initializeSecureSecrets();
    expect(getCachedSecureSecret(meshcoreRoomSecretKey(129))).toBe('credential-129');
    expect(window.electronAPI.secureSecrets.set).not.toHaveBeenCalled();
  });

  it('keeps unreadable protected rows ahead of stale legacy settings during an outage', async () => {
    const key = meshcoreRoomSecretKey(42);
    secureValues.set(key, 'protected-current');
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        [`${MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX}42`]: 'stale-legacy',
      }),
    );
    vi.mocked(window.electronAPI.secureSecrets.status).mockResolvedValue({
      available: false,
      persistent: false,
    });
    vi.mocked(window.electronAPI.secureSecrets.getAll).mockResolvedValue({});
    await expect(initializeSecureSecrets()).rejects.toThrow(/protected credential unavailable/);
    expect(getCachedSecureSecret(key)).toBeNull();
    expect(localStorage.getItem(`mesh-client:credentialCompatibility:${key}`)).toBeNull();

    installSecureSecretApi();
    resetSecureSecretCacheForTests();
    await initializeSecureSecrets();
    expect(secureValues.get(key)).toBe('protected-current');
    expect(getCachedSecureSecret(key)).toBe('protected-current');
  });

  it('does not revive a forgotten legacy room credential on the next start', async () => {
    const key = meshcoreRoomSecretKey(42);
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        [`${MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX}42`]: 'old-password',
      }),
    );
    vi.mocked(window.electronAPI.secureSecrets.status).mockResolvedValue({
      available: false,
      persistent: false,
    });
    await initializeSecureSecrets();
    expect(getCachedSecureSecret(key)).toBe('old-password');
    await removeSecureSecret(key);
    resetSecureSecretCacheForTests();
    await initializeSecureSecrets();
    expect(getCachedSecureSecret(key)).toBeNull();
    expect(localStorage.getItem(`mesh-client:credentialCompatibility:${key}`)).toBeNull();
    expect(
      JSON.parse(
        appSettingsValues.get(`rendererDeletedStorage:mesh-client:credentialCompatibility:${key}`)!,
      ),
    ).toMatchObject({ deleted: true });
    expect(JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}')).not.toHaveProperty(
      `${MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX}42`,
    );
  });

  it('drops empty legacy room credential slots without calling secureSecrets:set', async () => {
    const settingKey = `${MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX}9677130`;
    const key = meshcoreRoomSecretKey(9677130);
    appSettingsValues.set(settingKey, '');
    localStorage.setItem(
      `mesh-client:credentialCompatibility:${key}`,
      JSON.stringify({ value: '', id: 'empty', origin: 'file://' }),
    );

    await initializeSecureSecretsFailClosed();

    expect(window.electronAPI.secureSecrets.set).not.toHaveBeenCalled();
    expect(window.electronAPI.appSettings.remove).toHaveBeenCalledWith(settingKey);
    expect(appSettingsValues.has(settingKey)).toBe(false);
    expect(localStorage.getItem(`mesh-client:credentialCompatibility:${key}`)).toBeNull();
    expect(getCachedSecureSecret(key)).toBeNull();
  });

  it('opens with retained encrypted legacy values when the keyring is unavailable', async () => {
    localStorage.setItem('mesh-client:meshcoreIdentityEncPK', 'still-encrypted');
    localStorage.setItem('mesh-client:meshcore-key-backup:14', 'still-encrypted');
    vi.mocked(window.electronAPI.secureSecrets.status).mockResolvedValue({
      available: false,
      persistent: false,
    });
    await expect(initializeSecureSecretsFailClosed()).resolves.toBeUndefined();
    expect(window.electronAPI.secureSecrets.migrateLegacyIdentityCiphertext).not.toHaveBeenCalled();
    expect(window.electronAPI.secureSecrets.migrateLegacyBackupCiphertext).not.toHaveBeenCalled();
    expect(localStorage.getItem('mesh-client:meshcoreIdentityEncPK')).toBe('still-encrypted');
  });

  it('does not write compatibility storage for an already encrypted credential', async () => {
    const setItem = vi.spyOn(localStorage, 'setItem');
    await setSecureSecret(MESHCORE_MQTT_SECRET_KEY, 'encrypted-value');
    expect(setItem).not.toHaveBeenCalledWith(
      'mesh-client:credentialCompatibility:mqtt:meshcore',
      expect.anything(),
    );
    setItem.mockRestore();
  });

  it('migrates and erases every legacy plaintext/ciphertext credential class', async () => {
    secureValues.set(
      MESHCORE_MQTT_SECRET_KEY,
      JSON.stringify({ password: 'current-meshcore-password' }),
    );
    localStorage.setItem(
      'mesh-client:meshcoreIdentity',
      JSON.stringify({
        public_key: 'public-key',
        private_key: Array.from({ length: 32 }, (_, index) => index),
      }),
    );
    localStorage.setItem(
      'mesh-client:mqttSettings:meshcore',
      JSON.stringify({ server: 'broker', password: 'meshcore-password', channelPsks: ['mc-psk'] }),
    );
    localStorage.setItem(
      'mesh-client:mqttSettings',
      JSON.stringify({
        server: 'broker',
        password: 'meshtastic-password',
        channelPsks: ['mt-psk'],
      }),
    );
    localStorage.setItem(
      'mesh-client:mqttProfiles:meshtastic',
      JSON.stringify([
        {
          id: 'profile-1',
          name: 'Private broker',
          server: 'broker',
          port: 8883,
          username: 'operator',
          password: 'profile-password',
          topicPrefix: 'mesh/private',
        },
      ]),
    );
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        theme: 'dark',
        [`${MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX}11`]: JSON.stringify({ password: 'room' }),
        [`${MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX}12`]: JSON.stringify({
          password: 'repeater',
        }),
      }),
    );
    appSettingsValues.set(
      `${MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX}13`,
      JSON.stringify({ password: 'db-room' }),
    );
    const meshcoreBackup = JSON.stringify({
      protocol: 'meshcore',
      nodeId: 14,
      publicKey: Buffer.from(new Uint8Array(32).fill(1)).toString('base64'),
      privateKey: Buffer.from(new Uint8Array(64).fill(2)).toString('base64'),
      backedUpAt: 1,
    });
    const meshtasticBackup = JSON.stringify({
      protocol: 'meshtastic',
      nodeNum: 15,
      publicKey: Buffer.from(new Uint8Array(32).fill(3)).toString('base64'),
      privateKey: Buffer.from(new Uint8Array(32).fill(4)).toString('base64'),
      backedUpAt: 2,
    });
    localStorage.setItem(
      'mesh-client:meshcore-key-backup:14',
      Buffer.from(`protected:${meshcoreBackup}`).toString('base64'),
    );
    localStorage.setItem(
      'mesh-client:meshtastic-dm-key-backup:15',
      Buffer.from(`protected:${meshtasticBackup}`).toString('base64'),
    );

    await initializeSecureSecrets();

    expect(JSON.parse(getCachedSecureSecret(MESHCORE_IDENTITY_SECRET_KEY) ?? '[]')).toHaveLength(
      32,
    );
    expect(JSON.parse(getCachedSecureSecret(MESHCORE_MQTT_SECRET_KEY) ?? '{}')).toEqual({
      channelPsks: ['mc-psk'],
      password: 'current-meshcore-password',
    });
    expect(JSON.parse(getCachedSecureSecret(MESHTASTIC_MQTT_SECRET_KEY) ?? '{}')).toEqual({
      password: 'meshtastic-password',
      channelPsks: ['mt-psk'],
    });
    expect(JSON.parse(getCachedSecureSecret(MQTT_PROFILES_SECRET_KEY) ?? '{}')).toEqual({
      'profile-1': 'profile-password',
    });
    expect(getCachedSecureSecret(meshcoreRoomSecretKey(11))).toContain('room');
    expect(getCachedSecureSecret(meshcoreRepeaterSecretKey(12))).toContain('repeater');
    expect(getCachedSecureSecret(meshcoreRoomSecretKey(13))).toContain('db-room');
    expect(getCachedSecureSecret(keyBackupSecretKey('meshcore', 14))).toBe(meshcoreBackup);
    expect(getCachedSecureSecret(keyBackupSecretKey('meshtastic', 15))).toBe(meshtasticBackup);

    expect(JSON.parse(localStorage.getItem('mesh-client:meshcoreIdentity') ?? '{}')).toEqual({
      public_key: 'public-key',
    });
    expect(JSON.parse(localStorage.getItem('mesh-client:mqttSettings:meshcore') ?? '{}')).toEqual({
      server: 'broker',
    });
    expect(JSON.parse(localStorage.getItem('mesh-client:mqttSettings') ?? '{}')).toEqual({
      server: 'broker',
    });
    expect(localStorage.getItem('mesh-client:mqttProfiles:meshtastic')).not.toContain(
      'profile-password',
    );
    expect(JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}')).toEqual({
      theme: 'dark',
    });
    expect(
      [...appSettingsValues.keys()].every((key) => key.startsWith('rendererDeletedStorage:')),
    ).toBe(true);
    expect(localStorage.getItem('mesh-client:meshcore-key-backup:14')).toBeNull();
    expect(localStorage.getItem('mesh-client:meshtastic-dm-key-backup:15')).toBeNull();

    const remainingProfile = Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? '';
      return [key, localStorage.getItem(key)];
    });
    expect(JSON.stringify(remainingProfile)).not.toMatch(
      /private_key|meshcore-password|meshtastic-password|profile-password|mc-psk|mt-psk|db-room|repeater/,
    );
  });

  it('fails closed and preserves legacy data when verified import fails', async () => {
    localStorage.setItem(
      'mesh-client:mqttSettings:meshcore',
      JSON.stringify({ password: 'must-not-be-erased' }),
    );
    window.electronAPI.secureSecrets.set = vi.fn().mockRejectedValue(new Error('store failed'));

    await expect(initializeSecureSecretsFailClosed()).rejects.toThrow('store failed');
    expect(localStorage.getItem('mesh-client:mqttSettings:meshcore')).toContain(
      'must-not-be-erased',
    );
  });

  it('hydrates many secure values through one batch IPC request', async () => {
    for (let id = 0; id < 150; id += 1) {
      secureValues.set(meshcoreRepeaterSecretKey(id), `credential-${id}`);
    }

    await initializeSecureSecrets();

    expect(window.electronAPI.secureSecrets.getAll).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.secureSecrets.list).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.secureSecrets.get).not.toHaveBeenCalled();
    expect(getCachedSecureSecret(meshcoreRepeaterSecretKey(149))).toBe('credential-149');
  });

  it('routes pre-split MeshCore MQTT settings before secret migration', async () => {
    localStorage.setItem(
      'mesh-client:mqttSettings',
      JSON.stringify({
        topicPrefix: 'meshcore/custom',
        server: 'meshcore.example',
        password: 'meshcore-secret',
      }),
    );

    const setItem = vi.spyOn(localStorage, 'setItem');
    await initializeSecureSecrets();

    expect(JSON.parse(getCachedSecureSecret(MESHCORE_MQTT_SECRET_KEY) ?? '{}')).toEqual({
      password: 'meshcore-secret',
    });
    expect(getCachedSecureSecret(MESHTASTIC_MQTT_SECRET_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem('mesh-client:mqttSettings:meshcore') ?? '{}')).toEqual({
      topicPrefix: 'meshcore/custom',
      server: 'meshcore.example',
    });
    expect(localStorage.getItem('mesh-client:mqttSettings')).toBeNull();
    expect(
      setItem.mock.calls.filter(([key]) => key === 'mesh-client:mqttSettings:meshcore'),
    ).toEqual([
      [
        'mesh-client:mqttSettings:meshcore',
        JSON.stringify({ topicPrefix: 'meshcore/custom', server: 'meshcore.example' }),
      ],
    ]);
    setItem.mockRestore();
  });

  it('uses prepared routing metadata and leaves cleaned source placement for preference finalization', async () => {
    localStorage.setItem(
      'mesh-client:mqttSettings',
      JSON.stringify({ topicPrefix: 'stale-topic', password: 'source-secret' }),
    );
    await initializeSecureSecrets({
      'mesh-client:mqttSettings': JSON.stringify({
        topicPrefix: 'meshcore/canonical',
        server: 'canonical-broker',
      }),
    });
    expect(getCachedSecureSecret(MESHCORE_MQTT_SECRET_KEY)).toBe('{"password":"source-secret"}');
    expect(getCachedSecureSecret(MESHTASTIC_MQTT_SECRET_KEY)).toBeNull();
    expect(localStorage.getItem('mesh-client:mqttSettings:meshcore')).toBeNull();
    expect(JSON.parse(localStorage.getItem('mesh-client:mqttSettings')!)).toEqual({
      topicPrefix: 'stale-topic',
    });
  });

  it.each<Record<string, string>>([
    {},
    { 'mesh-client:mqttSettings': JSON.stringify({ topicPrefix: 'msh/canonical' }) },
    {
      'mesh-client:mqttSettings': JSON.stringify({ topicPrefix: 'meshcore/canonical' }),
      'mesh-client:mqttSettings:meshcore': JSON.stringify({ server: 'existing-canonical' }),
    },
  ])(
    'does not route stale source metadata over prepared routing context %j',
    async (preferences) => {
      localStorage.setItem(
        'mesh-client:mqttSettings',
        JSON.stringify({ topicPrefix: 'meshcore/stale', password: 'source-secret' }),
      );
      await initializeSecureSecrets(preferences);
      expect(getCachedSecureSecret(MESHTASTIC_MQTT_SECRET_KEY)).toBe(
        '{"password":"source-secret"}',
      );
      expect(getCachedSecureSecret(MESHCORE_MQTT_SECRET_KEY)).toBeNull();
      expect(localStorage.getItem('mesh-client:mqttSettings:meshcore')).toBeNull();
    },
  );

  it('preserves a routed original in place when compatibility acknowledgement fails', async () => {
    const raw = JSON.stringify(
      { topicPrefix: 'meshcore/source', password: 'source-secret' },
      null,
      2,
    );
    localStorage.setItem('mesh-client:mqttSettings', raw);
    vi.mocked(window.electronAPI.secureSecrets.status).mockResolvedValue({
      available: false,
      persistent: false,
    });
    vi.mocked(window.electronAPI.appSettings.set).mockRejectedValue(new Error('receipt rejected'));
    await expect(initializeSecureSecrets()).rejects.toThrow(/receipt was not persisted/);
    expect(localStorage.getItem('mesh-client:mqttSettings')).toBe(raw);
    expect(localStorage.getItem('mesh-client:mqttSettings:meshcore')).toBeNull();
  });

  it.each([
    ['mesh-client:meshcoreIdentity', '{bad-json'],
    ['mesh-client:mqttSettings', '{bad-json'],
    ['mesh-client:mqttProfiles:meshtastic', '{bad-json'],
    [APP_SETTINGS_STORAGE_KEY, '{bad-json'],
  ])('fails closed and preserves malformed known legacy record %s', async (key, raw) => {
    localStorage.setItem(key, raw);

    await expect(initializeSecureSecretsFailClosed()).rejects.toThrow(/malformed/);
    expect(localStorage.getItem(key)).toBe(raw);
  });

  it('fails closed and preserves a legacy backup when verified import fails', async () => {
    const storageKey = 'mesh-client:meshtastic-dm-key-backup:22';
    localStorage.setItem(storageKey, 'legacy-ciphertext');
    window.electronAPI.secureSecrets.migrateLegacyBackupCiphertext = vi
      .fn()
      .mockResolvedValue({ available: true, persistent: true, verified: false });

    await expect(initializeSecureSecretsFailClosed()).rejects.toThrow(
      'legacy backup verification failed',
    );
    expect(localStorage.getItem(storageKey)).toBe('legacy-ciphertext');
  });

  it('scrubs both settings aliases while preserving current credential precedence', async () => {
    const currentKey = `${MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX}42`;
    const legacyKey = `${MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX}43`;
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ theme: 'dark', [currentKey]: 'current-room' }),
    );
    localStorage.setItem(
      LEGACY_APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        theme: 'light',
        [currentKey]: 'obsolete-room',
        [legacyKey]: 'legacy-repeater',
      }),
    );

    await initializeSecureSecrets();

    expect(getCachedSecureSecret(meshcoreRoomSecretKey(42))).toBe('current-room');
    expect(getCachedSecureSecret(meshcoreRepeaterSecretKey(43))).toBe('legacy-repeater');
    expect(JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)!)).toEqual({ theme: 'dark' });
    expect(JSON.parse(localStorage.getItem(LEGACY_APP_SETTINGS_STORAGE_KEY)!)).toEqual({
      theme: 'light',
    });
  });

  it('preserves durable backup ciphertext when the import is session-only', async () => {
    const storageKey = 'mesh-client:meshtastic-dm-key-backup:22';
    localStorage.setItem(storageKey, 'legacy-ciphertext');
    window.electronAPI.secureSecrets.migrateLegacyBackupCiphertext = vi
      .fn()
      .mockResolvedValue({ available: true, persistent: false, verified: true });

    await expect(initializeSecureSecretsFailClosed()).resolves.toBeUndefined();
    expect(localStorage.getItem(storageKey)).toBe('legacy-ciphertext');
  });

  it('retires inline credentials after a session-only save acknowledges compatibility storage', async () => {
    const raw = JSON.stringify({
      [`${MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX}42`]: 'room-password',
    });
    localStorage.setItem(LEGACY_APP_SETTINGS_STORAGE_KEY, raw);
    window.electronAPI.secureSecrets.set = vi
      .fn()
      .mockResolvedValue({ available: true, persistent: false, verified: true });

    await expect(initializeSecureSecretsFailClosed()).resolves.toBeUndefined();
    expect(localStorage.getItem(LEGACY_APP_SETTINGS_STORAGE_KEY)).toBe('{}');
    expect(getCachedSecureSecret(meshcoreRoomSecretKey(42))).toBe('room-password');
    expect(
      JSON.parse(
        localStorage.getItem(`mesh-client:credentialCompatibility:${meshcoreRoomSecretKey(42)}`)!,
      ),
    ).toMatchObject({ value: 'room-password' });
  });

  describe.each(inlineCredentialSources)('$name inline retirement', (source) => {
    it('acknowledges the newer readable secure value before retiring an older inline copy during an outage', async () => {
      const current =
        source.secretKey === MESHCORE_IDENTITY_SECRET_KEY
          ? JSON.stringify(Array(32).fill(8))
          : source.secretKey === MQTT_PROFILES_SECRET_KEY
            ? JSON.stringify({ saved: 'newer-password' })
            : source.secretKey.startsWith('mqtt:')
              ? JSON.stringify({ password: 'newer-password', channelPsks: [] })
              : 'newer-password';
      localStorage.setItem(source.storageKey, source.raw);
      secureValues.set(source.secretKey, current);
      vi.mocked(window.electronAPI.secureSecrets.status).mockResolvedValue({
        available: false,
        persistent: false,
      });

      await initializeSecureSecretsFailClosed();

      expect(getCachedSecureSecret(source.secretKey)).toBe(current);
      expect(JSON.parse(localStorage.getItem(source.storageKey)!)).toEqual(source.metadata);
      expect(
        JSON.parse(
          localStorage.getItem(`mesh-client:credentialCompatibility:${source.secretKey}`)!,
        ),
      ).toMatchObject({ value: current });
    });
    it.each(['outage', 'session-only'] as const)(
      'retires its source only after an acknowledged %s compatibility replacement',
      async (mode) => {
        localStorage.setItem(source.storageKey, source.raw);
        if (mode === 'outage') {
          vi.mocked(window.electronAPI.secureSecrets.status).mockResolvedValue({
            available: false,
            persistent: false,
          });
        } else {
          vi.mocked(window.electronAPI.secureSecrets.set).mockResolvedValue({
            available: false,
            persistent: false,
            verified: true,
          });
        }

        await initializeSecureSecretsFailClosed();

        expect(JSON.parse(localStorage.getItem(source.storageKey)!)).toEqual(source.metadata);
        expect(getCachedSecureSecret(source.secretKey)).toBe(source.secret);
        const compatibilityKey = `mesh-client:credentialCompatibility:${source.secretKey}`;
        const compatibility = JSON.parse(localStorage.getItem(compatibilityKey)!);
        const receipt = JSON.parse(
          appSettingsValues.get(`rendererDeletedStorage:${compatibilityKey}`)!,
        );
        expect(compatibility.value).toBe(source.secret);
        expect(receipt).toMatchObject({
          deleted: false,
          applied: { [compatibility.origin]: compatibility.id },
        });
        expect(secureSecretsInitialized()).toBe(true);
      },
    );

    it('preserves the original bytes when compatibility acknowledgement fails and retires them on Retry', async () => {
      localStorage.setItem(source.storageKey, source.raw);
      vi.mocked(window.electronAPI.secureSecrets.status).mockResolvedValue({
        available: false,
        persistent: false,
      });
      let rejectReceipt = true;
      vi.mocked(window.electronAPI.appSettings.set).mockImplementation((key, value) => {
        if (rejectReceipt) return Promise.reject(new Error('receipt rejected'));
        appSettingsValues.set(key, value);
        return Promise.resolve({ changes: 1 });
      });

      await expect(initializeSecureSecretsFailClosed()).rejects.toThrow(
        /receipt was not persisted/,
      );
      expect(localStorage.getItem(source.storageKey)).toBe(source.raw);
      expect(secureSecretsInitialized()).toBe(false);

      rejectReceipt = false;
      await initializeSecureSecretsFailClosed();
      expect(JSON.parse(localStorage.getItem(source.storageKey)!)).toEqual(source.metadata);
      expect(getCachedSecureSecret(source.secretKey)).toBe(source.secret);
    });

    it.each([false, true])(
      'preserves a known unreadable row and source with keyring persistent=%s, then retries',
      async (persistent) => {
        localStorage.setItem(source.storageKey, source.raw);
        secureValues.set(source.secretKey, source.secret);
        // Even an old handled/deletion receipt cannot classify an extant unreadable row as absent.
        appSettingsValues.set(
          `rendererDeletedStorage:mesh-client:credentialCompatibility:${source.secretKey}`,
          '1',
        );
        vi.mocked(window.electronAPI.secureSecrets.status).mockResolvedValue({
          available: persistent,
          persistent,
        });
        vi.mocked(window.electronAPI.secureSecrets.getAll).mockResolvedValue({});

        await expect(initializeSecureSecretsFailClosed()).rejects.toThrow(
          /protected credential unavailable/,
        );
        expect(localStorage.getItem(source.storageKey)).toBe(source.raw);
        expect(getUnavailableStartupCredentialKeys()).toEqual([source.secretKey]);
        expect(secureValues.get(source.secretKey)).toBe(source.secret);
        expect(isProtectedSecureSecretUnavailable(source.secretKey)).toBe(true);
        expect(window.electronAPI.secureSecrets.set).not.toHaveBeenCalled();
        expect(window.electronAPI.secureSecrets.remove).not.toHaveBeenCalled();
        expect(
          localStorage.getItem(`mesh-client:credentialCompatibility:${source.secretKey}`),
        ).toBeNull();

        installSecureSecretApi();
        await initializeSecureSecretsFailClosed();
        expect(JSON.parse(localStorage.getItem(source.storageKey)!)).toEqual(source.metadata);
        expect(getCachedSecureSecret(source.secretKey)).toBe(source.secret);
        expect(getUnavailableStartupCredentialKeys()).toEqual([]);
      },
    );

    it('allows explicit Forget of an unreadable row without reviving its inline source', async () => {
      const unrelated = meshcoreRoomSecretKey(900);
      const unreadableUnrelated = meshcoreRepeaterSecretKey(901);
      const backup = keyBackupSecretKey('meshcore', 902);
      localStorage.setItem(source.storageKey, source.raw);
      secureValues.set(source.secretKey, source.secret);
      secureValues.set(unrelated, 'readable-unrelated');
      secureValues.set(unreadableUnrelated, 'protected-unrelated');
      secureValues.set(backup, 'protected-backup');
      vi.mocked(window.electronAPI.secureSecrets.status).mockResolvedValue({
        available: false,
        persistent: false,
      });
      vi.mocked(window.electronAPI.secureSecrets.getAll).mockResolvedValue({
        [unrelated]: 'readable-unrelated',
      });
      await expect(initializeSecureSecrets()).rejects.toThrow(/protected credential unavailable/);
      expect(getUnavailableStartupCredentialKeys()).toEqual([source.secretKey]);

      await forgetUnavailableStartupCredentials([source.secretKey]);
      expect(getUnavailableStartupCredentialKeys()).toEqual([]);
      resetSecureSecretCacheForTests();
      await initializeSecureSecretsFailClosed();

      expect(secureValues.has(source.secretKey)).toBe(false);
      expect(getCachedSecureSecret(source.secretKey)).toBeNull();
      expect(JSON.parse(localStorage.getItem(source.storageKey)!)).toEqual(source.metadata);
      expect(
        localStorage.getItem(`mesh-client:credentialCompatibility:${source.secretKey}`),
      ).toBeNull();
      expect(secureValues.get(unrelated)).toBe('readable-unrelated');
      expect(secureValues.get(unreadableUnrelated)).toBe('protected-unrelated');
      expect(secureValues.get(backup)).toBe('protected-backup');
    });
  });

  it('keeps encrypted identity ciphertext when its existing native row is individually unreadable', async () => {
    secureValues.set(MESHCORE_IDENTITY_SECRET_KEY, JSON.stringify(Array(32).fill(9)));
    vi.mocked(window.electronAPI.secureSecrets.getAll).mockResolvedValue({});
    localStorage.setItem('mesh-client:meshcoreIdentityEncPK', 'original-encrypted-source');
    await initializeSecureSecretsFailClosed();
    expect(localStorage.getItem('mesh-client:meshcoreIdentityEncPK')).toBe(
      'original-encrypted-source',
    );
    expect(window.electronAPI.secureSecrets.migrateLegacyIdentityCiphertext).not.toHaveBeenCalled();
    expect(isProtectedSecureSecretUnavailable(MESHCORE_IDENTITY_SECRET_KEY)).toBe(true);
    expect(getUnavailableStartupCredentialKeys()).toEqual([]);
  });

  describe('scoped startup credential recovery', () => {
    const blocked = meshcoreRoomSecretKey(42);
    const settingKey = `${MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX}42`;
    const raw = JSON.stringify({ theme: 'dark', [settingKey]: 'legacy-source' });

    async function blockStartup(): Promise<void> {
      localStorage.setItem(APP_SETTINGS_STORAGE_KEY, raw);
      secureValues.set(blocked, 'permanently-unreadable');
      vi.mocked(window.electronAPI.secureSecrets.getAll).mockResolvedValue({});
      await expect(initializeSecureSecrets()).rejects.toThrow(/protected credential unavailable/);
      expect(getUnavailableStartupCredentialKeys()).toEqual([blocked]);
    }

    it('rejects an empty or unrelated selection before deleting any credential', async () => {
      const readable = meshcoreRoomSecretKey(99);
      const backup = keyBackupSecretKey('meshcore', 100);
      await blockStartup();
      await setSecureSecret(readable, 'unrelated-readable');
      secureValues.set(backup, 'unrelated-backup');
      for (const selection of [
        [],
        [blocked, blocked],
        [blocked, readable],
        [readable],
        [backup],
        ['__proto__'],
        ['mqtt:unknown'],
      ]) {
        await expect(forgetUnavailableStartupCredentials(selection)).rejects.toThrow(
          /no longer eligible/,
        );
      }
      for (const selection of [
        null,
        'not-an-array',
        [blocked, undefined],
        [blocked, ...Array(1)],
      ]) {
        await expect(
          forgetUnavailableStartupCredentials(selection as unknown as readonly string[]),
        ).rejects.toThrow(/no longer eligible/);
      }
      expect(window.electronAPI.secureSecrets.remove).not.toHaveBeenCalled();
      expect(secureValues.get(blocked)).toBe('permanently-unreadable');
      expect(secureValues.get(readable)).toBe('unrelated-readable');
      expect(secureValues.get(backup)).toBe('unrelated-backup');
      expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toBe(raw);
    });

    it('rejects a stale selection after Retry makes the credential readable', async () => {
      await blockStartup();
      installSecureSecretApi();
      await initializeSecureSecrets();
      expect(getUnavailableStartupCredentialKeys()).toEqual([]);
      await expect(forgetUnavailableStartupCredentials([blocked])).rejects.toThrow(
        /no longer eligible/,
      );
      expect(secureValues.get(blocked)).toBe('permanently-unreadable');
      expect(window.electronAPI.secureSecrets.remove).not.toHaveBeenCalled();
    });

    it('rejects a stale selection after an explicit replacement save', async () => {
      await blockStartup();
      await setSecureSecret(blocked, 'new-readable-credential');
      expect(getUnavailableStartupCredentialKeys()).toEqual([]);
      await expect(forgetUnavailableStartupCredentials([blocked])).rejects.toThrow(
        /no longer eligible/,
      );
      expect(secureValues.get(blocked)).toBe('new-readable-credential');
      expect(window.electronAPI.secureSecrets.remove).not.toHaveBeenCalled();
    });

    it('rechecks queued selection eligibility after a preceding Forget completes', async () => {
      await blockStartup();
      const first = removeSecureSecret(blocked);
      const second = expect(forgetUnavailableStartupCredentials([blocked])).rejects.toThrow(
        /no longer eligible/,
      );
      await first;
      await second;
      expect(window.electronAPI.secureSecrets.remove).toHaveBeenCalledTimes(1);
    });

    it('preserves the source and remains retryable when its acknowledgement fails', async () => {
      await blockStartup();
      let rejectReceipt = true;
      vi.mocked(window.electronAPI.appSettings.set).mockImplementation((key, value) => {
        if (rejectReceipt) return Promise.reject(new Error('receipt rejected'));
        appSettingsValues.set(key, value);
        return Promise.resolve({ changes: 1 });
      });
      await expect(forgetUnavailableStartupCredentials([blocked])).rejects.toThrow(
        /receipt was not persisted/,
      );
      expect(window.electronAPI.secureSecrets.remove).not.toHaveBeenCalled();
      expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toBe(raw);
      expect(getUnavailableStartupCredentialKeys()).toEqual([blocked]);

      rejectReceipt = false;
      await forgetUnavailableStartupCredentials([blocked]);
      expect(getUnavailableStartupCredentialKeys()).toEqual([]);
      expect(JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)!)).toEqual({
        theme: 'dark',
      });
    });

    it('preserves the source and remains retryable when native removal fails', async () => {
      await blockStartup();
      vi.mocked(window.electronAPI.secureSecrets.remove).mockRejectedValueOnce(
        new Error('remove failed'),
      );
      await expect(forgetUnavailableStartupCredentials([blocked])).rejects.toThrow('remove failed');
      expect(secureValues.has(blocked)).toBe(true);
      expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toBe(raw);
      expect(getUnavailableStartupCredentialKeys()).toEqual([blocked]);

      await forgetUnavailableStartupCredentials([blocked]);
      expect(secureValues.has(blocked)).toBe(false);
      expect(getUnavailableStartupCredentialKeys()).toEqual([]);
      expect(JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)!)).toEqual({
        theme: 'dark',
      });
    });

    it('can retry partial cleanup after native deletion without losing unrelated preferences', async () => {
      await blockStartup();
      const originalSet = localStorage.setItem.bind(localStorage);
      let failCleanup = true;
      const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
        if (key === APP_SETTINGS_STORAGE_KEY && failCleanup) throw new Error('cache unavailable');
        originalSet(key, value);
      });
      await expect(forgetUnavailableStartupCredentials([blocked])).rejects.toThrow(
        'cache unavailable',
      );
      expect(secureValues.has(blocked)).toBe(false);
      expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toBe(raw);
      expect(getUnavailableStartupCredentialKeys()).toEqual([blocked]);

      failCleanup = false;
      await forgetUnavailableStartupCredentials([blocked]);
      expect(getUnavailableStartupCredentialKeys()).toEqual([]);
      expect(JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)!)).toEqual({
        theme: 'dark',
      });
      expect(localStorage.getItem(`mesh-client:credentialCompatibility:${blocked}`)).toBeNull();
      setItem.mockRestore();
    });

    it('recomputes one failed credential at a time across startup retries', async () => {
      const next = meshcoreRepeaterSecretKey(43);
      const nextSetting = `${MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX}43`;
      await blockStartup();
      secureValues.set(next, 'second-unreadable');
      localStorage.setItem(
        APP_SETTINGS_STORAGE_KEY,
        JSON.stringify({
          theme: 'dark',
          [settingKey]: 'legacy-source',
          [nextSetting]: 'second-legacy',
        }),
      );
      await forgetUnavailableStartupCredentials([blocked]);
      await expect(initializeSecureSecrets()).rejects.toThrow(/protected credential unavailable/);
      expect(getUnavailableStartupCredentialKeys()).toEqual([next]);
      await expect(forgetUnavailableStartupCredentials([blocked])).rejects.toThrow(
        /no longer eligible/,
      );
      await forgetUnavailableStartupCredentials([next]);
      await initializeSecureSecrets();
      expect(getUnavailableStartupCredentialKeys()).toEqual([]);
      expect(JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)!)).toEqual({
        theme: 'dark',
      });
    });
  });

  it.each([
    [MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX, meshcoreRoomSecretKey(42)],
    [MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX, meshcoreRepeaterSecretKey(42)],
  ])(
    'retains SQLite source %s until an outage receipt acknowledges it, then retries',
    async (prefix, secretKey) => {
      const settingKey = `${prefix}42`;
      appSettingsValues.set(settingKey, 'sqlite-only-credential');
      vi.mocked(window.electronAPI.secureSecrets.status).mockResolvedValue({
        available: false,
        persistent: false,
      });
      let rejectReceipt = true;
      vi.mocked(window.electronAPI.appSettings.set).mockImplementation((key, value) => {
        if (rejectReceipt) return Promise.reject(new Error('receipt rejected'));
        appSettingsValues.set(key, value);
        return Promise.resolve({ changes: 1 });
      });

      await expect(initializeSecureSecrets()).rejects.toThrow(/receipt was not persisted/);
      expect(appSettingsValues.get(settingKey)).toBe('sqlite-only-credential');
      expect(window.electronAPI.appSettings.remove).not.toHaveBeenCalledWith(settingKey);

      rejectReceipt = false;
      await initializeSecureSecrets();
      expect(appSettingsValues.has(settingKey)).toBe(false);
      expect(getCachedSecureSecret(secretKey)).toBe('sqlite-only-credential');
      const compatibilityKey = `mesh-client:credentialCompatibility:${secretKey}`;
      const compatibility = JSON.parse(localStorage.getItem(compatibilityKey)!);
      const receipt = JSON.parse(
        appSettingsValues.get(`rendererDeletedStorage:${compatibilityKey}`)!,
      );
      expect(receipt.applied[compatibility.origin]).toBe(compatibility.id);
    },
  );

  it('resumes a partially migrated credential collection instead of replaying its prefix', async () => {
    const credentials = Object.fromEntries(
      Array.from({ length: 120 }, (_, id) => [
        `${MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX}${String(id)}`,
        `password-${String(id)}`,
      ]),
    );
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(credentials));
    let writes = 0;
    vi.mocked(window.electronAPI.secureSecrets.set).mockImplementation((key, value) => {
      if (++writes > 118) return Promise.reject(new Error('rate limit'));
      secureValues.set(key, value);
      return Promise.resolve({ available: true, persistent: true, verified: true });
    });
    await expect(initializeSecureSecrets()).rejects.toThrow('rate limit');
    expect(Object.keys(JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)!))).toHaveLength(
      2,
    );
    writes = 0;
    await initializeSecureSecrets();
    expect(writes).toBe(2);
    expect(getCachedSecureSecret(meshcoreRepeaterSecretKey(119))).toBe('password-119');
    expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toBe('{}');
  });

  it('scrubs stale SQLite credentials without overwriting current local or secure values', async () => {
    const localKey = `${MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX}42`;
    const secureKey = `${MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX}43`;
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ [localKey]: 'current-local' }));
    secureValues.set(meshcoreRepeaterSecretKey(43), 'current-secure');
    appSettingsValues.set(localKey, 'obsolete-db-room');
    appSettingsValues.set(secureKey, 'obsolete-db-repeater');
    await initializeSecureSecrets();
    expect(getCachedSecureSecret(meshcoreRoomSecretKey(42))).toBe('current-local');
    expect(getCachedSecureSecret(meshcoreRepeaterSecretKey(43))).toBe('current-secure');
    expect(
      [...appSettingsValues.keys()].every((key) => key.startsWith('rendererDeletedStorage:')),
    ).toBe(true);
  });

  it('preserves a legacy backup when the secure slot contains a different key pair', async () => {
    const id = 22;
    const storageKey = `mesh-client:meshtastic-dm-key-backup:${String(id)}`;
    const existing = JSON.stringify({
      protocol: 'meshtastic',
      nodeNum: id,
      publicKey: Buffer.alloc(32, 1).toString('base64'),
      privateKey: Buffer.alloc(32, 2).toString('base64'),
      backedUpAt: 2,
    });
    const legacy = JSON.stringify({
      protocol: 'meshtastic',
      nodeNum: id,
      publicKey: Buffer.alloc(32, 3).toString('base64'),
      privateKey: Buffer.alloc(32, 4).toString('base64'),
      backedUpAt: 1,
    });
    secureValues.set(keyBackupSecretKey('meshtastic', id), existing);
    localStorage.setItem(storageKey, Buffer.from(`protected:${legacy}`, 'utf8').toString('base64'));

    await expect(initializeSecureSecretsFailClosed()).rejects.toThrow(/conflicting legacy backup/);
    expect(localStorage.getItem(storageKey)).not.toBeNull();
    expect(secureValues.get(keyBackupSecretKey('meshtastic', id))).toBe(existing);
  });
});
