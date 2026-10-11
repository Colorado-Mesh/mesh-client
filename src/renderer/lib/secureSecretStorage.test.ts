import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX,
  MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX,
} from '@/shared/appSettingsKeyPrefixes';

import { APP_SETTINGS_STORAGE_KEY } from './appSettingsStorage';
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
  resetSecureSecretCacheForTests,
} from './secureSecretStorage';

const secureValues = new Map<string, string>();
const appSettingsValues = new Map<string, string>();

function installSecureSecretApi(): void {
  window.electronAPI.secureSecrets = {
    status: vi.fn().mockResolvedValue({ available: true, persistent: true }),
    list: vi.fn(() => Promise.resolve([...secureValues.keys()])),
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
        secureValues.set(keyBackupSecretKey(protocol, id), decoded);
        return Promise.resolve({ available: true, persistent: true, verified: true });
      },
    ),
  };
  window.electronAPI.appSettings.getAll = vi.fn(() =>
    Promise.resolve(Object.fromEntries(appSettingsValues)),
  );
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
    expect(appSettingsValues.size).toBe(0);
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
});
