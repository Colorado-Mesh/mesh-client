import { afterEach, describe, expect, it } from 'vitest';

import { readMeshcoreMqttSettingsFromStorage } from './meshcoreMqttSettingsStorage';

describe('readMeshcoreMqttSettingsFromStorage', () => {
  afterEach(() => {
    localStorage.removeItem('mesh-client:mqttSettings:meshcore');
  });

  it('returns defaults when key missing', () => {
    const s = readMeshcoreMqttSettingsFromStorage();
    expect(s.topicPrefix).toBe('meshcore');
    expect(s.meshcorePacketLoggerEnabled).toBeUndefined();
  });

  it('merges stored settings', () => {
    localStorage.setItem(
      'mesh-client:mqttSettings:meshcore',
      JSON.stringify({
        server: 'mqtt-us-v1.letsmesh.net',
        meshcorePacketLoggerEnabled: true,
      }),
    );
    const s = readMeshcoreMqttSettingsFromStorage();
    expect(s.server).toBe('mqtt-us-v1.letsmesh.net');
    expect(s.meshcorePacketLoggerEnabled).toBe(true);
  });
});
