import { describe, expect, it } from 'vitest';

import {
  isMeshtasticContactEligibleForUserGroup,
  MESHTASTIC_CONTACT_GROUP_BUILTIN_GPS,
  MESHTASTIC_CONTACT_GROUP_BUILTIN_RF_MQTT,
  meshtasticContactGroupMatchesBuiltinGps,
  meshtasticContactGroupMatchesBuiltinRfMqtt,
} from './meshtasticContactGroupUtils';
import type { MeshNode } from './types';

function node(partial: Partial<MeshNode> & Pick<MeshNode, 'node_id'>): MeshNode {
  return {
    long_name: 'N',
    short_name: '',
    hw_model: '',
    snr: 0,
    battery: 0,
    last_heard: 0,
    latitude: null,
    longitude: null,
    ...partial,
  };
}

describe('meshtasticContactGroupMatchesBuiltinGps', () => {
  it('includes nodes with valid non-zero coordinates and excludes self', () => {
    expect(
      meshtasticContactGroupMatchesBuiltinGps(
        node({ node_id: 10, latitude: 37.5, longitude: -122.4 }),
        99,
      ),
    ).toBe(true);
    expect(
      meshtasticContactGroupMatchesBuiltinGps(
        node({ node_id: 99, latitude: 37.5, longitude: -122.4 }),
        99,
      ),
    ).toBe(false);
  });

  it('rejects 0,0 and null coordinates', () => {
    expect(
      meshtasticContactGroupMatchesBuiltinGps(node({ node_id: 1, latitude: 0, longitude: 0 }), 0),
    ).toBe(false);
    expect(
      meshtasticContactGroupMatchesBuiltinGps(node({ node_id: 1, latitude: 0, longitude: 0 }), 1),
    ).toBe(false);
    expect(
      meshtasticContactGroupMatchesBuiltinGps(
        node({ node_id: 2, latitude: null, longitude: null }),
        0,
      ),
    ).toBe(false);
  });

  it('exposes stable built-in ids', () => {
    expect(MESHTASTIC_CONTACT_GROUP_BUILTIN_GPS).toBe(-10);
    expect(MESHTASTIC_CONTACT_GROUP_BUILTIN_RF_MQTT).toBe(-11);
  });
});

describe('meshtasticContactGroupMatchesBuiltinRfMqtt', () => {
  it('matches hybrid RF+MQTT session flags', () => {
    expect(
      meshtasticContactGroupMatchesBuiltinRfMqtt(
        node({ node_id: 5, heard_via_mqtt: true, heard_via_mqtt_only: false }),
        1,
      ),
    ).toBe(true);
    expect(
      meshtasticContactGroupMatchesBuiltinRfMqtt(
        node({ node_id: 5, heard_via_mqtt: true, heard_via_mqtt_only: true }),
        1,
      ),
    ).toBe(false);
    expect(
      meshtasticContactGroupMatchesBuiltinRfMqtt(
        node({ node_id: 5, heard_via_mqtt: false, heard_via_mqtt_only: false }),
        1,
      ),
    ).toBe(false);
  });

  it('excludes self', () => {
    expect(
      meshtasticContactGroupMatchesBuiltinRfMqtt(
        node({ node_id: 1, heard_via_mqtt: true, heard_via_mqtt_only: false }),
        1,
      ),
    ).toBe(false);
  });
});

describe('isMeshtasticContactEligibleForUserGroup', () => {
  it('allows non-self when self is known', () => {
    expect(isMeshtasticContactEligibleForUserGroup(node({ node_id: 2 }), 1)).toBe(true);
    expect(isMeshtasticContactEligibleForUserGroup(node({ node_id: 1 }), 1)).toBe(false);
  });

  it('rejects when self unknown', () => {
    expect(isMeshtasticContactEligibleForUserGroup(node({ node_id: 2 }), null)).toBe(false);
    expect(isMeshtasticContactEligibleForUserGroup(node({ node_id: 2 }), 0)).toBe(false);
  });
});
