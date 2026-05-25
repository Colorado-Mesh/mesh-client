import { afterEach, describe, expect, it } from 'vitest';

import {
  loadMeshtasticMqttManualChannelPsksFromStorage,
  MESHTASTIC_MQTT_SETTINGS_KEY,
} from './meshtasticMqttSettingsStorage';

const MESHCORE_KEY = 'mesh-client:mqttSettings:meshcore';
const RECOVERY_FLAG = 'mesh-client:migrated:meshtastic-psk-recovery-v1';
const KEY_B = 'AAAAAAAAAAAAAAAAAAAAAA==';

describe('loadMeshtasticMqttManualChannelPsksFromStorage', () => {
  afterEach(() => {
    localStorage.removeItem(MESHTASTIC_MQTT_SETTINGS_KEY);
    localStorage.removeItem(MESHCORE_KEY);
    localStorage.removeItem(RECOVERY_FLAG);
  });

  it('returns empty when no settings exist', () => {
    expect(loadMeshtasticMqttManualChannelPsksFromStorage()).toEqual([]);
  });

  it('reads channelPsks from mesh-client:mqttSettings', () => {
    localStorage.setItem(
      MESHTASTIC_MQTT_SETTINGS_KEY,
      JSON.stringify({ channelPsks: [`HamNet=${KEY_B}`] }),
    );
    expect(loadMeshtasticMqttManualChannelPsksFromStorage()).toEqual([`HamNet=${KEY_B}`]);
  });

  it('recovers channelPsks from meshcore blob after legacy migration emptied meshtastic key', () => {
    localStorage.removeItem(MESHTASTIC_MQTT_SETTINGS_KEY);
    localStorage.setItem(
      MESHCORE_KEY,
      JSON.stringify({
        topicPrefix: 'meshcore/DEN',
        channelPsks: [`LongFast@0=${KEY_B}`, `TGIFMESH@1=${KEY_B}`],
      }),
    );

    expect(loadMeshtasticMqttManualChannelPsksFromStorage()).toEqual([
      `LongFast@0=${KEY_B}`,
      `TGIFMESH@1=${KEY_B}`,
    ]);

    const recovered = JSON.parse(localStorage.getItem(MESHTASTIC_MQTT_SETTINGS_KEY) ?? '{}') as {
      channelPsks?: string[];
    };
    expect(recovered.channelPsks).toEqual([`LongFast@0=${KEY_B}`, `TGIFMESH@1=${KEY_B}`]);
    expect(localStorage.getItem(RECOVERY_FLAG)).toBe('1');
  });

  it('prefers meshtastic key when channelPsks already present', () => {
    localStorage.setItem(
      MESHTASTIC_MQTT_SETTINGS_KEY,
      JSON.stringify({ channelPsks: [`Primary=${KEY_B}`] }),
    );
    localStorage.setItem(MESHCORE_KEY, JSON.stringify({ channelPsks: [`Other=${KEY_B}`] }));

    expect(loadMeshtasticMqttManualChannelPsksFromStorage()).toEqual([`Primary=${KEY_B}`]);
    expect(JSON.parse(localStorage.getItem(MESHTASTIC_MQTT_SETTINGS_KEY) ?? '{}')).toEqual({
      channelPsks: [`Primary=${KEY_B}`],
    });
  });
});
