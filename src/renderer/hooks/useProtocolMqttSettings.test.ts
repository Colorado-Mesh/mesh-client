// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initializeSecureSecrets,
  resetSecureSecretCacheForTests,
} from '@/renderer/lib/secureSecretStorage';

import {
  getMqttSettingsStorageKey,
  loadProtocolMqttSettings,
  persistMqttSettingsIfChanged,
} from './useProtocolMqttSettings';

describe('useProtocolMqttSettings helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSecureSecretCacheForTests();
    vi.mocked(window.electronAPI.secureSecrets.set).mockClear();
  });

  it('maps storage keys by protocol', () => {
    expect(getMqttSettingsStorageKey('meshtastic')).toBe('mesh-client:mqttSettings');
    expect(getMqttSettingsStorageKey('meshcore')).toBe('mesh-client:mqttSettings:meshcore');
  });

  it('loads protocol defaults from storage helpers', () => {
    const meshtastic = loadProtocolMqttSettings('meshtastic');
    expect(meshtastic.topicPrefix).toBeTruthy();
    const meshcore = loadProtocolMqttSettings('meshcore');
    expect(meshcore.topicPrefix).toBe('meshcore');
  });

  it('preserves an unreadable protected password during preference-only updates', async () => {
    vi.mocked(window.electronAPI.secureSecrets.status).mockResolvedValueOnce({
      available: false,
      persistent: false,
    });
    vi.mocked(window.electronAPI.secureSecrets.list).mockResolvedValueOnce(['mqtt:meshcore']);
    vi.mocked(window.electronAPI.secureSecrets.getAll).mockResolvedValueOnce({});
    await initializeSecureSecrets();
    const settings = { ...loadProtocolMqttSettings('meshcore'), server: 'new-broker.example' };
    persistMqttSettingsIfChanged('mesh-client:mqttSettings:meshcore', settings);
    expect(window.electronAPI.secureSecrets.set).not.toHaveBeenCalled();
    expect(localStorage.getItem('mesh-client:credentialCompatibility:mqtt:meshcore')).toBeNull();
    expect(loadProtocolMqttSettings('meshcore').server).toBe('new-broker.example');
  });

  it('persists preferences separately from credentials and skips identical secret JSON', async () => {
    const key = 'test-mqtt-persist';
    const settings = loadProtocolMqttSettings('meshcore');
    localStorage.setItem(key, '{"legacy":true}');
    persistMqttSettingsIfChanged(key, settings);
    persistMqttSettingsIfChanged(key, settings);
    await vi.waitFor(() => {
      expect(JSON.parse(localStorage.getItem(key)!)).toHaveProperty('server', settings.server);
    });
    expect(window.electronAPI.secureSecrets.set).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.secureSecrets.set).toHaveBeenCalledWith(
      'mqtt:meshtastic',
      JSON.stringify({ password: settings.password, channelPsks: settings.channelPsks }),
    );
  });

  it('persists an intentional empty password as a secure override', async () => {
    const settings = { ...loadProtocolMqttSettings('meshtastic'), password: '' };

    persistMqttSettingsIfChanged('mesh-client:mqttSettings', settings);

    await vi.waitFor(() => {
      expect(window.electronAPI.secureSecrets.set).toHaveBeenCalledWith(
        'mqtt:meshtastic',
        JSON.stringify({ password: '' }),
      );
    });
  });

  it.each(['meshcore', 'meshtastic'] as const)(
    'retains %s preferences after a session-only restart',
    async (protocol) => {
      const key = getMqttSettingsStorageKey(protocol);
      const defaultPassword = loadProtocolMqttSettings(protocol).password;
      const settings = {
        ...loadProtocolMqttSettings(protocol),
        server: 'custom.example',
        port: 8883,
        topicPrefix: 'custom',
        autoLaunch: true,
        password: 'private-password',
        channelPsks: ['private-key'],
      };
      vi.mocked(window.electronAPI.secureSecrets.set).mockResolvedValueOnce({
        available: true,
        persistent: false,
        verified: true,
      });
      persistMqttSettingsIfChanged(key, settings);
      await vi.waitFor(() => {
        expect(localStorage.getItem(key)).toContain('custom.example');
      });
      expect(localStorage.getItem(key)).not.toContain('private-password');
      expect(localStorage.getItem(key)).not.toContain('private-key');
      resetSecureSecretCacheForTests();
      expect(loadProtocolMqttSettings(protocol)).toMatchObject({
        server: 'custom.example',
        port: 8883,
        topicPrefix: 'custom',
        autoLaunch: true,
        password: defaultPassword,
      });
    },
  );

  it('keeps legacy settings when queued secure writes both fail', async () => {
    const key = 'mesh-client:mqttSettings';
    const settings = loadProtocolMqttSettings('meshtastic');
    localStorage.setItem(key, '{"legacy":true}');
    vi.mocked(window.electronAPI.secureSecrets.set)
      .mockRejectedValueOnce(new Error('first failed'))
      .mockRejectedValueOnce(new Error('retry failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    persistMqttSettingsIfChanged(key, settings);
    persistMqttSettingsIfChanged(key, settings);

    await vi.waitFor(() => {
      expect(window.electronAPI.secureSecrets.set).toHaveBeenCalledTimes(2);
    });
    expect(localStorage.getItem(key)).toBe('{"legacy":true}');
    warn.mockRestore();
  });
});
