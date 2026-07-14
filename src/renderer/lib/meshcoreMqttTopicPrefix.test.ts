// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { COLORADO_MESH_HOST, LETSMESH_HOST_US, MESHMAPPER_HOST } from './letsMeshJwt';
import {
  isIataScopedMeshcoreMqtt,
  isValidMeshcoreIataTopicPrefix,
  normalizeMeshcoreIataTopicPrefix,
  parseMeshcoreIataTopicPrefix,
} from './meshcoreMqttTopicPrefix';

describe('parseMeshcoreIataTopicPrefix', () => {
  it('accepts meshcore/test and normalizes case', () => {
    expect(parseMeshcoreIataTopicPrefix('meshcore/test')).toEqual({
      ok: true,
      normalized: 'meshcore/test',
      segment: 'test',
    });
    expect(parseMeshcoreIataTopicPrefix('meshcore/TEST')).toEqual({
      ok: true,
      normalized: 'meshcore/test',
      segment: 'test',
    });
  });

  it('accepts 3-letter IATA and uppercases', () => {
    expect(parseMeshcoreIataTopicPrefix('meshcore/den')).toEqual({
      ok: true,
      normalized: 'meshcore/DEN',
      segment: 'DEN',
    });
    expect(parseMeshcoreIataTopicPrefix('meshcore/DEN/')).toEqual({
      ok: true,
      normalized: 'meshcore/DEN',
      segment: 'DEN',
    });
  });

  it('rejects malformed prefixes and wildcards', () => {
    expect(parseMeshcoreIataTopicPrefix('meshcore').ok).toBe(false);
    expect(parseMeshcoreIataTopicPrefix('meshcore/xx').ok).toBe(false);
    expect(parseMeshcoreIataTopicPrefix('meshcore/Denver').ok).toBe(false);
    expect(parseMeshcoreIataTopicPrefix('meshcore/DE+').ok).toBe(false);
    expect(parseMeshcoreIataTopicPrefix('meshcore/DE#').ok).toBe(false);
    expect(parseMeshcoreIataTopicPrefix('').ok).toBe(false);
  });
});

describe('normalizeMeshcoreIataTopicPrefix', () => {
  it('returns normalized string or null', () => {
    expect(normalizeMeshcoreIataTopicPrefix('meshcore/den')).toBe('meshcore/DEN');
    expect(normalizeMeshcoreIataTopicPrefix('meshcore/xx')).toBeNull();
  });
});

describe('isIataScopedMeshcoreMqtt', () => {
  it('is true for LetsMesh / Colorado / MeshMapper presets and device-signing hosts', () => {
    expect(isIataScopedMeshcoreMqtt('letsmesh', { server: '' })).toBe(true);
    expect(isIataScopedMeshcoreMqtt('coloradomesh', { server: '' })).toBe(true);
    expect(isIataScopedMeshcoreMqtt('meshmapper', { server: '' })).toBe(true);
    expect(isIataScopedMeshcoreMqtt('custom', { server: COLORADO_MESH_HOST })).toBe(true);
    expect(isIataScopedMeshcoreMqtt('custom', { server: LETSMESH_HOST_US })).toBe(true);
    expect(isIataScopedMeshcoreMqtt('custom', { server: MESHMAPPER_HOST })).toBe(true);
  });

  it('is false for Ripple and arbitrary custom brokers', () => {
    expect(isIataScopedMeshcoreMqtt('ripple', { server: 'mqtt.ripplenetworks.com.au' })).toBe(
      false,
    );
    expect(isIataScopedMeshcoreMqtt('custom', { server: 'mqtt.example.com' })).toBe(false);
  });
});

describe('isValidMeshcoreIataTopicPrefix', () => {
  it('skips validation when not IATA-scoped', () => {
    expect(
      isValidMeshcoreIataTopicPrefix('ripple', {
        server: 'mqtt.ripplenetworks.com.au',
        topicPrefix: 'meshcore',
      }),
    ).toBe(true);
  });

  it('requires valid shape when IATA-scoped', () => {
    expect(
      isValidMeshcoreIataTopicPrefix('coloradomesh', {
        server: COLORADO_MESH_HOST,
        topicPrefix: 'meshcore/DEN',
      }),
    ).toBe(true);
    expect(
      isValidMeshcoreIataTopicPrefix('coloradomesh', {
        server: COLORADO_MESH_HOST,
        topicPrefix: 'meshcore/xx',
      }),
    ).toBe(false);
  });
});
