import { afterEach, describe, expect, it, vi } from 'vitest';

import { COLORADO_MQTT_REGION_ACK_KEY } from './connectionPanelStorageMigrations';
import { MESHCORE_ENC_PK_KEY, MESHCORE_IDENTITY_STORAGE_KEY } from './letsMeshJwt';
import { MESHTASTIC_MQTT_SETTINGS_KEY } from './meshtasticMqttSettingsStorage';
import { tryAutoLaunchMqtt } from './mqttAutoLaunch';

describe('tryAutoLaunchMqtt', () => {
  afterEach(() => {
    localStorage.removeItem(MESHTASTIC_MQTT_SETTINGS_KEY);
    localStorage.removeItem('mesh-client:mqttSettings:meshcore');
    localStorage.removeItem('mesh-client:mqttPreset:meshcore');
    localStorage.removeItem(COLORADO_MQTT_REGION_ACK_KEY);
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

  it('defers MeshCore Colorado auto-launch until region ack', async () => {
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'coloradomesh');
    localStorage.setItem(
      'mesh-client:mqttSettings:meshcore',
      JSON.stringify({
        server: 'mqtt.meshcore.coloradomesh.org',
        port: 443,
        topicPrefix: 'meshcore/DEN',
        autoLaunch: true,
        useWebSocket: true,
        tlsEnabled: true,
      }),
    );
    const connect = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', {
      electronAPI: { mqtt: { connect } },
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await tryAutoLaunchMqtt('meshcore');

    expect(connect).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Colorado Mesh region confirmation pending'),
    );
  });
});

describe('shouldAutoLaunchMeshcoreMqttAtStartup', () => {
  const MESHCORE_KEY = 'mesh-client:mqttSettings:meshcore';

  afterEach(() => {
    localStorage.removeItem(MESHCORE_KEY);
    localStorage.removeItem('mesh-client:mqttPreset:meshcore');
    localStorage.removeItem(COLORADO_MQTT_REGION_ACK_KEY);
    localStorage.removeItem(MESHCORE_IDENTITY_STORAGE_KEY);
    localStorage.removeItem(MESHCORE_ENC_PK_KEY);
  });

  it('defers JWT broker auto-launch until private key is cached', async () => {
    const { shouldAutoLaunchMeshcoreMqttAtStartup } = await import('./mqttAutoLaunch');
    localStorage.setItem(COLORADO_MQTT_REGION_ACK_KEY, '1');
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'coloradomesh');
    localStorage.setItem(
      MESHCORE_KEY,
      JSON.stringify({
        server: 'mqtt.meshcore.coloradomesh.org',
        port: 443,
        autoLaunch: true,
        useWebSocket: true,
      }),
    );
    expect(shouldAutoLaunchMeshcoreMqttAtStartup()).toBe(false);

    localStorage.setItem(MESHCORE_IDENTITY_STORAGE_KEY, JSON.stringify({ public_key: [1, 2] }));
    localStorage.setItem(MESHCORE_ENC_PK_KEY, 'enc');
    expect(shouldAutoLaunchMeshcoreMqttAtStartup()).toBe(true);
  });

  it('returns false when Colorado region ack is pending even with identity keys', async () => {
    const { shouldAutoLaunchMeshcoreMqttAtStartup } = await import('./mqttAutoLaunch');
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'coloradomesh');
    localStorage.setItem(
      MESHCORE_KEY,
      JSON.stringify({
        server: 'mqtt.meshcore.coloradomesh.org',
        port: 443,
        autoLaunch: true,
        useWebSocket: true,
      }),
    );
    localStorage.setItem(MESHCORE_IDENTITY_STORAGE_KEY, JSON.stringify({ public_key: [1, 2] }));
    localStorage.setItem(MESHCORE_ENC_PK_KEY, 'enc');
    expect(shouldAutoLaunchMeshcoreMqttAtStartup()).toBe(false);
  });

  it('returns false when autoLaunch is disabled even if identity keys are present', async () => {
    const { shouldAutoLaunchMeshcoreMqttAtStartup } = await import('./mqttAutoLaunch');
    localStorage.setItem(COLORADO_MQTT_REGION_ACK_KEY, '1');
    localStorage.setItem(
      MESHCORE_KEY,
      JSON.stringify({
        server: 'mqtt.meshcore.coloradomesh.org',
        port: 443,
        autoLaunch: false,
        useWebSocket: true,
      }),
    );
    localStorage.setItem(MESHCORE_IDENTITY_STORAGE_KEY, JSON.stringify({ public_key: [1, 2] }));
    localStorage.setItem(MESHCORE_ENC_PK_KEY, 'enc');
    expect(shouldAutoLaunchMeshcoreMqttAtStartup()).toBe(false);
  });

  it('returns false when meshcore MQTT settings are absent', async () => {
    const { shouldAutoLaunchMeshcoreMqttAtStartup } = await import('./mqttAutoLaunch');
    expect(shouldAutoLaunchMeshcoreMqttAtStartup()).toBe(false);
  });
});
