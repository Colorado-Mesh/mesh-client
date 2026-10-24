import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX,
  MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX,
} from '@/shared/appSettingsKeyPrefixes';

import { APP_SETTINGS_STORAGE_KEY, LEGACY_APP_SETTINGS_STORAGE_KEY } from './appSettingsStorage';
import {
  getCachedSecureSecret,
  initializeSecureSecrets,
  initializeSecureSecretsFailClosed,
  keyBackupSecretKey,
  MESHCORE_IDENTITY_SECRET_KEY,
  MESHCORE_MQTT_SECRET_KEY,
  meshcoreRepeaterSecretKey,
  meshcoreRoomSecretKey,
  MESHTASTIC_MQTT_SECRET_KEY,
  MQTT_PROFILES_SECRET_KEY,
  removeSecureSecret,
  resetSecureSecretCacheForTests,
  setSecureSecret,
} from './secureSecretStorage';

const secureValues = new Map<string, string>();
const appSettingsValues = new Map<string, string>();

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
    await initializeSecureSecrets();
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
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
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
    expect(window.electronAPI.secureSecrets.list).not.toHaveBeenCalled();
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

  it('preserves saved credentials when secure persistence is unavailable', async () => {
    const raw = JSON.stringify({
      [`${MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX}42`]: 'room-password',
    });
    localStorage.setItem(LEGACY_APP_SETTINGS_STORAGE_KEY, raw);
    window.electronAPI.secureSecrets.set = vi
      .fn()
      .mockResolvedValue({ available: true, persistent: false, verified: true });

    await expect(initializeSecureSecretsFailClosed()).resolves.toBeUndefined();
    expect(localStorage.getItem(LEGACY_APP_SETTINGS_STORAGE_KEY)).toBe(raw);
    expect(getCachedSecureSecret(meshcoreRoomSecretKey(42))).toBe('room-password');
  });

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
