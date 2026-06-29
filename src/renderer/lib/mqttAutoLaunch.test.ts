import { afterEach, describe, expect, it, vi } from 'vitest';

import { MESHTASTIC_MQTT_SETTINGS_KEY } from './meshtasticMqttSettingsStorage';
import { tryAutoLaunchMqtt } from './mqttAutoLaunch';

describe('tryAutoLaunchMqtt', () => {
  afterEach(() => {
    localStorage.removeItem(MESHTASTIC_MQTT_SETTINGS_KEY);
    localStorage.removeItem('mesh-client:mqttSettings:meshcore');
    vi.restoreAllMocks();
  });

  it('connects Meshtastic MQTT when autoLaunch is enabled', async () => {
    localStorage.setItem(
      MESHTASTIC_MQTT_SETTINGS_KEY,
      JSON.stringify({
        server: 'mqtt.meshtastic.org',
        port: 1883,
        username: 'meshdev',
        password: 'large4cats',
        topicPrefix: 'msh/US/',
        autoLaunch: true,
      }),
    );
    const connect = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', {
      electronAPI: { mqtt: { connect } },
    });

    await tryAutoLaunchMqtt('meshtastic');

    expect(connect).toHaveBeenCalledOnce();
    expect(connect.mock.calls[0][0]).toMatchObject({
      mqttTransportProtocol: 'meshtastic',
      autoLaunch: true,
    });
  });

  it('skips Meshtastic MQTT when autoLaunch is disabled', async () => {
    localStorage.setItem(
      MESHTASTIC_MQTT_SETTINGS_KEY,
      JSON.stringify({ autoLaunch: false, server: 'mqtt.meshtastic.org' }),
    );
    const connect = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', {
      electronAPI: { mqtt: { connect } },
    });

    await tryAutoLaunchMqtt('meshtastic');

    expect(connect).not.toHaveBeenCalled();
  });

  it('skips Reticulum (no MQTT transport)', async () => {
    localStorage.setItem(
      MESHTASTIC_MQTT_SETTINGS_KEY,
      JSON.stringify({ autoLaunch: true, server: 'mqtt.meshtastic.org' }),
    );
    const connect = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', {
      electronAPI: { mqtt: { connect } },
    });

    await tryAutoLaunchMqtt('reticulum');

    expect(connect).not.toHaveBeenCalled();
  });
});
