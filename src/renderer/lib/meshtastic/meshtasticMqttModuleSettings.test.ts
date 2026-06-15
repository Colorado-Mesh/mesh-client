import { describe, expect, it } from 'vitest';

import {
  isMeshtasticMqttProxyActive,
  mqttSettingsFromMeshtasticModuleConfig,
} from './meshtasticMqttModuleSettings';

describe('meshtasticMqttModuleSettings', () => {
  it('detects active proxy when enabled and proxyToClientEnabled', () => {
    expect(
      isMeshtasticMqttProxyActive({
        mqtt: { enabled: true, proxyToClientEnabled: true },
      }),
    ).toBe(true);
    expect(
      isMeshtasticMqttProxyActive({
        mqtt: { enabled: true, proxyToClientEnabled: false },
      }),
    ).toBe(false);
  });

  it('maps module config to MQTTSettings for proxy gateway', () => {
    const settings = mqttSettingsFromMeshtasticModuleConfig({
      mqtt: {
        enabled: true,
        proxyToClientEnabled: true,
        address: 'mqtt.example.com:8883',
        username: 'user',
        password: 'pass',
        root: 'msh/US',
        tlsEnabled: true,
      },
    });
    expect(settings).toMatchObject({
      server: 'mqtt.example.com',
      port: 8883,
      username: 'user',
      password: 'pass',
      topicPrefix: 'msh/US/',
      tlsEnabled: true,
      mqttTransportProtocol: 'meshtastic',
      autoLaunch: false,
    });
  });

  it('returns null when proxy not enabled', () => {
    expect(mqttSettingsFromMeshtasticModuleConfig({ mqtt: { enabled: true } })).toBeNull();
    expect(mqttSettingsFromMeshtasticModuleConfig({})).toBeNull();
  });
});
