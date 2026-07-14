// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { COLORADO_MESH_HOST, LETSMESH_HOST_EU, LETSMESH_HOST_US } from './letsMeshJwt';
import { applyMeshcoreMqttPreset, readStoredMeshcoreMqttPreset } from './meshcoreMqttPresets';
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
});
