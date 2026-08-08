// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COLORADO_MESH_HOST,
  EASTMESH_HOST,
  LETSMESH_HOST_EU,
  LETSMESH_HOST_US,
  MESHATSE_HOST,
  MESHCORE_CA_HOST_BACKUP,
  MESHCORE_CA_HOST_PRIMARY,
  MESHMAPPER_HOST,
  WAEV_HOST,
} from './letsMeshJwt';
import {
  applyMeshcoreMqttPreset,
  isDeviceSigningMeshcorePreset,
  readStoredMeshcoreMqttPreset,
  usesMeshcoreDeviceSigningMqtt,
} from './meshcoreMqttPresets';
import type { MQTTSettings } from './types';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  });
});

const base: MQTTSettings = {
  server: '',
  port: 1883,
  username: 'v1_' + 'a'.repeat(64),
  password: 'tok',
  topicPrefix: 'meshcore',
  autoLaunch: true,
};

describe('applyMeshcoreMqttPreset', () => {
  it('applies Colorado Mesh defaults while preserving user fields', () => {
    const next = applyMeshcoreMqttPreset('coloradomesh', base);
    expect(next.server).toBe(COLORADO_MESH_HOST);
    expect(next.port).toBe(443);
    expect(next.topicPrefix).toBe('meshcore/DEN');
    expect(next.useWebSocket).toBe(true);
    expect(next.tlsEnabled).toBe(true);
    expect(next.wsPath).toBe('/ws');
    expect(next.username).toBe(base.username);
    expect(next.autoLaunch).toBe(true);
    expect(next.password).toBe('');
  });

  it('preserves LetsMesh EU server when already selected', () => {
    const next = applyMeshcoreMqttPreset('letsmesh', { ...base, server: LETSMESH_HOST_EU });
    expect(next.server).toBe(LETSMESH_HOST_EU);
    expect(next.port).toBe(443);
  });

  it('defaults LetsMesh to US when server is stale', () => {
    const next = applyMeshcoreMqttPreset('letsmesh', { ...base, server: COLORADO_MESH_HOST });
    expect(next.server).toBe(LETSMESH_HOST_US);
  });

  it('applies MeshMapper .net host with WSS on 443', () => {
    const next = applyMeshcoreMqttPreset('meshmapper', base);
    expect(next.server).toBe(MESHMAPPER_HOST);
    expect(MESHMAPPER_HOST).toBe('mqtt.meshmapper.net');
    expect(next.port).toBe(443);
    expect(next.useWebSocket).toBe(true);
    expect(next.tlsEnabled).toBe(true);
    expect(next.wsPath).toBe('/ws');
    expect(next.topicPrefix).toBe('meshcore/test');
    expect(next.password).toBe('');
  });

  it('applies Waev broker with WSS + /mqtt path on 443', () => {
    const next = applyMeshcoreMqttPreset('waev', base);
    expect(next.server).toBe(WAEV_HOST);
    expect(WAEV_HOST).toBe('mqtt.waev.app');
    expect(next.port).toBe(443);
    expect(next.useWebSocket).toBe(true);
    expect(next.tlsEnabled).toBe(true);
    expect(next.wsPath).toBe('/mqtt');
    expect(next.topicPrefix).toBe('meshcore/test');
    expect(next.password).toBe('');
    expect(next.username).toBe(base.username);
  });

  it('applies Meshat.se broker with WSS + /mqtt path on 443', () => {
    const next = applyMeshcoreMqttPreset('meshatse', base);
    expect(next.server).toBe(MESHATSE_HOST);
    expect(MESHATSE_HOST).toBe('meshcore-mqtt.meshat.se');
    expect(next.port).toBe(443);
    expect(next.wsPath).toBe('/mqtt');
    expect(next.tlsEnabled).toBe(true);
    expect(next.password).toBe('');
  });

  it('applies EastMesh broker with WSS + /mqtt path on 443', () => {
    const next = applyMeshcoreMqttPreset('eastmesh', base);
    expect(next.server).toBe(EASTMESH_HOST);
    expect(EASTMESH_HOST).toBe('mqtt2.eastmesh.au');
    expect(next.port).toBe(443);
    expect(next.wsPath).toBe('/mqtt');
    expect(next.tlsEnabled).toBe(true);
    expect(next.password).toBe('');
  });

  it('defaults MeshCore.CA to the primary broker host', () => {
    const next = applyMeshcoreMqttPreset('meshcoreca', base);
    expect(next.server).toBe(MESHCORE_CA_HOST_PRIMARY);
    expect(MESHCORE_CA_HOST_PRIMARY).toBe('mqtt1.meshcore.ca');
    expect(next.port).toBe(443);
    expect(next.wsPath).toBe('/mqtt');
    expect(next.password).toBe('');
  });

  it('preserves the MeshCore.CA backup broker host when already selected', () => {
    const next = applyMeshcoreMqttPreset('meshcoreca', {
      ...base,
      server: MESHCORE_CA_HOST_BACKUP,
    });
    expect(next.server).toBe(MESHCORE_CA_HOST_BACKUP);
    expect(MESHCORE_CA_HOST_BACKUP).toBe('mqtt2.meshcore.ca');
  });

  it('restores certificate verification when switching from Ripple (tlsInsecure) to a device-signing preset', () => {
    // Ripple leaves tlsInsecure=true; a device-signing preset must reset it so the JWT WSS
    // connection verifies certificates again.
    const fromRipple: MQTTSettings = {
      ...base,
      server: 'mqtt.ripplenetworks.com.au',
      tlsInsecure: true,
    };
    const next = applyMeshcoreMqttPreset('waev', fromRipple);
    expect(next.tlsInsecure).toBe(false);
    expect(next.server).toBe(WAEV_HOST);
    expect(next.tlsEnabled).toBe(true);
  });
});

describe('usesMeshcoreDeviceSigningMqtt', () => {
  it('is true for a named device-signing preset (Waev)', () => {
    expect(usesMeshcoreDeviceSigningMqtt('waev', { server: WAEV_HOST })).toBe(true);
  });

  it('is true for Custom settings pointed at a device-signing host (mqtt.waev.app)', () => {
    expect(usesMeshcoreDeviceSigningMqtt('custom', { server: WAEV_HOST })).toBe(true);
  });

  it('is false for Custom settings pointed at an unmatched host', () => {
    expect(usesMeshcoreDeviceSigningMqtt('custom', { server: 'mqtt.example.com' })).toBe(false);
  });
});

describe('isDeviceSigningMeshcorePreset', () => {
  it('is true for JWT device-signing presets', () => {
    for (const preset of [
      'letsmesh',
      'coloradomesh',
      'meshmapper',
      'waev',
      'meshatse',
      'meshcoreca',
      'eastmesh',
    ] as const) {
      expect(isDeviceSigningMeshcorePreset(preset)).toBe(true);
    }
  });

  it('is false for ripple, custom, and nullish presets', () => {
    expect(isDeviceSigningMeshcorePreset('ripple')).toBe(false);
    expect(isDeviceSigningMeshcorePreset('custom')).toBe(false);
    expect(isDeviceSigningMeshcorePreset(null)).toBe(false);
    expect(isDeviceSigningMeshcorePreset(undefined)).toBe(false);
  });
});

describe('readStoredMeshcoreMqttPreset', () => {
  it('returns letsmesh when preset key is missing (new default)', () => {
    expect(readStoredMeshcoreMqttPreset()).toBe('letsmesh');
  });

  it('returns custom when preset is unknown', () => {
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'unknown');
    expect(readStoredMeshcoreMqttPreset()).toBe('custom');
  });

  it('returns saved preset id', () => {
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'coloradomesh');
    expect(readStoredMeshcoreMqttPreset()).toBe('coloradomesh');
  });

  it('recognizes the newly added device-signing preset ids', () => {
    for (const preset of ['waev', 'meshatse', 'meshcoreca', 'eastmesh']) {
      localStorage.setItem('mesh-client:mqttPreset:meshcore', preset);
      expect(readStoredMeshcoreMqttPreset()).toBe(preset);
    }
  });
});
