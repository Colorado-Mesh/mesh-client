import { describe, expect, it } from 'vitest';

import type { MQTTSettings } from '@/renderer/lib/types';

import {
  isLiamBrokerSettings,
  isMeshtasticOfficialBrokerSettings,
  MESHTASTIC_LIAM_1883,
  MESHTASTIC_OFFICIAL_1883,
  meshtasticMqttErrorUserHint,
} from './meshtasticMqttTlsMigration';

describe('Meshtastic official broker presets', () => {
  it('1883 preset uses correct host and port', () => {
    expect(MESHTASTIC_OFFICIAL_1883.server).toBe('mqtt.meshtastic.org');
    expect(MESHTASTIC_OFFICIAL_1883.port).toBe(1883);
  });

  it('isMeshtasticOfficialBrokerSettings matches public host', () => {
    const s: MQTTSettings = { ...MESHTASTIC_OFFICIAL_1883 };
    expect(isMeshtasticOfficialBrokerSettings(s)).toBe(true);
    expect(isMeshtasticOfficialBrokerSettings({ ...s, server: 'other.example' })).toBe(false);
  });
});

describe('Liam broker preset', () => {
  it('uses port 1883 with uplink credentials', () => {
    expect(MESHTASTIC_LIAM_1883.server).toBe('mqtt.meshtastic.liamcottle.net');
    expect(MESHTASTIC_LIAM_1883.port).toBe(1883);
    expect(MESHTASTIC_LIAM_1883.username).toBe('uplink');
    expect(MESHTASTIC_LIAM_1883.password).toBe('uplink');
  });

  it('isLiamBrokerSettings matches liam host', () => {
    expect(isLiamBrokerSettings(MESHTASTIC_LIAM_1883)).toBe(true);
    expect(
      isLiamBrokerSettings({ ...MESHTASTIC_LIAM_1883, server: 'MQTT.MESHTASTIC.LIAMCOTTLE.NET' }),
    ).toBe(true);
    expect(isLiamBrokerSettings({ ...MESHTASTIC_LIAM_1883, server: 'mqtt.meshtastic.org' })).toBe(
      false,
    );
    expect(isLiamBrokerSettings(MESHTASTIC_OFFICIAL_1883)).toBe(false);
  });
});

describe('meshtasticMqttErrorUserHint', () => {
  it('returns errors unchanged', () => {
    expect(meshtasticMqttErrorUserHint('connack timeout')).toBe('connack timeout');
    expect(meshtasticMqttErrorUserHint('certificate has expired')).toBe('certificate has expired');
  });
});
