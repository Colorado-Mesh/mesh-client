import { describe, expect, it } from 'vitest';

import { shouldOpenMeshcomMqttPanel } from './meshcomMqttPanelOpen';

describe('shouldOpenMeshcomMqttPanel', () => {
  it('stays collapsed on empty default install', () => {
    expect(
      shouldOpenMeshcomMqttPanel({
        server: '',
        profileCount: 0,
        mqttStatus: 'disconnected',
      }),
    ).toBe(false);
  });

  it('opens when a broker server is set', () => {
    expect(
      shouldOpenMeshcomMqttPanel({
        server: 'broker.example',
        profileCount: 0,
        mqttStatus: 'disconnected',
      }),
    ).toBe(true);
  });

  it('opens when saved profiles exist', () => {
    expect(
      shouldOpenMeshcomMqttPanel({
        server: '  ',
        profileCount: 1,
        mqttStatus: 'disconnected',
      }),
    ).toBe(true);
  });

  it.each(['connected', 'connecting'] as const)('opens when mqttStatus is %s', (mqttStatus) => {
    expect(
      shouldOpenMeshcomMqttPanel({
        server: '',
        profileCount: 0,
        mqttStatus,
      }),
    ).toBe(true);
  });
});
