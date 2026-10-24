import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadMeshtasticMqttManualChannelPsksFromStorage,
  MESHTASTIC_MQTT_SETTINGS_KEY,
  readMeshtasticMqttSettingsFromStorage,
} from './meshtasticMqttSettingsStorage';
import {
  getCachedSecureSecret,
  MESHCORE_MQTT_SECRET_KEY,
  MESHTASTIC_MQTT_SECRET_KEY,
  resetSecureSecretCacheForTests,
  setSecureSecret,
} from './secureSecretStorage';

const RECOVERY_FLAG = 'mesh-client:migrated:meshtastic-psk-recovery-v1';
const KEY_B = 'AAAAAAAAAAAAAAAAAAAAAA==';

describe('readMeshtasticMqttSettingsFromStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSecureSecretCacheForTests();
  });

  it('returns defaults when storage is empty', () => {
    expect(readMeshtasticMqttSettingsFromStorage().autoLaunch).toBe(false);
    expect(readMeshtasticMqttSettingsFromStorage().server).toBe('mqtt.meshtastic.org');
  });

  it('reads autoLaunch from storage', () => {
    localStorage.setItem(MESHTASTIC_MQTT_SETTINGS_KEY, JSON.stringify({ autoLaunch: true }));
    expect(readMeshtasticMqttSettingsFromStorage().autoLaunch).toBe(true);
  });

  it('lets an explicit empty secure password override the official preset default', async () => {
    localStorage.setItem(MESHTASTIC_MQTT_SETTINGS_KEY, JSON.stringify({ autoLaunch: false }));
    await setSecureSecret(MESHTASTIC_MQTT_SECRET_KEY, JSON.stringify({ password: '' }));

    expect(readMeshtasticMqttSettingsFromStorage().password).toBe('');
  });
});

describe('loadMeshtasticMqttManualChannelPsksFromStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSecureSecretCacheForTests();
  });

  it('returns empty when no settings exist', () => {
    expect(loadMeshtasticMqttManualChannelPsksFromStorage()).toEqual([]);
  });

  it('reads channelPsks from secure storage', async () => {
    await setSecureSecret(
      MESHTASTIC_MQTT_SECRET_KEY,
      JSON.stringify({ channelPsks: [`HamNet=${KEY_B}`] }),
    );
    expect(loadMeshtasticMqttManualChannelPsksFromStorage()).toEqual([`HamNet=${KEY_B}`]);
  });

  it('recovers channelPsks from the migrated meshcore secure secret', async () => {
    await setSecureSecret(
      MESHCORE_MQTT_SECRET_KEY,
      JSON.stringify({
        topicPrefix: 'meshcore/DEN',
        channelPsks: [`LongFast@0=${KEY_B}`, `TGIFMESH@1=${KEY_B}`],
      }),
    );

    expect(loadMeshtasticMqttManualChannelPsksFromStorage()).toEqual([
      `LongFast@0=${KEY_B}`,
      `TGIFMESH@1=${KEY_B}`,
    ]);

    const recovered = JSON.parse(getCachedSecureSecret(MESHTASTIC_MQTT_SECRET_KEY) ?? '{}') as {
      channelPsks?: string[];
      autoLaunch?: boolean;
    };
    expect(recovered.channelPsks).toEqual([`LongFast@0=${KEY_B}`, `TGIFMESH@1=${KEY_B}`]);
    expect(recovered.autoLaunch).toBeUndefined();
    await vi.waitFor(() => {
      expect(localStorage.getItem(RECOVERY_FLAG)).toBe('1');
    });
  });

  it('returns recoverable PSKs while a competing secure save is still pending', async () => {
    await setSecureSecret(
      MESHCORE_MQTT_SECRET_KEY,
      JSON.stringify({ channelPsks: [`Recovered=${KEY_B}`] }),
    );
    let release!: () => void;
    vi.mocked(window.electronAPI.secureSecrets.set).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ available: true, persistent: true, verified: true });
          };
        }),
    );
    const saving = setSecureSecret(MESHTASTIC_MQTT_SECRET_KEY, '{"password":"current"}');
    expect(loadMeshtasticMqttManualChannelPsksFromStorage()).toEqual([`Recovered=${KEY_B}`]);
    release();
    await saving;
    await vi.waitFor(() => {
      expect(localStorage.getItem(RECOVERY_FLAG)).toBe('1');
    });
  });

  it('leaves recovery retryable when the secure write fails', async () => {
    await setSecureSecret(
      MESHCORE_MQTT_SECRET_KEY,
      JSON.stringify({ channelPsks: [`Retry=${KEY_B}`] }),
    );
    vi.mocked(window.electronAPI.secureSecrets.set).mockRejectedValueOnce(
      new Error('secure write failed'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    loadMeshtasticMqttManualChannelPsksFromStorage();

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalled();
    });
    expect(localStorage.getItem(RECOVERY_FLAG)).toBeNull();
    warn.mockRestore();
  });

  it('prefers the meshtastic secure secret when channelPsks already exist', async () => {
    await setSecureSecret(
      MESHTASTIC_MQTT_SECRET_KEY,
      JSON.stringify({ channelPsks: [`Primary=${KEY_B}`] }),
    );
    await setSecureSecret(
      MESHCORE_MQTT_SECRET_KEY,
      JSON.stringify({ channelPsks: [`Other=${KEY_B}`] }),
    );

    expect(loadMeshtasticMqttManualChannelPsksFromStorage()).toEqual([`Primary=${KEY_B}`]);
    expect(JSON.parse(getCachedSecureSecret(MESHTASTIC_MQTT_SECRET_KEY) ?? '{}')).toEqual({
      channelPsks: [`Primary=${KEY_B}`],
    });
  });
});
