import type { NodeRecord } from '../stores/nodeStore';
import { describe, expect, it } from 'vitest';

import {
  isMeshtasticContactEligibleForUserGroup,
  MESHTASTIC_CONTACT_GROUP_BUILTIN_GPS,
  MESHTASTIC_CONTACT_GROUP_BUILTIN_RF_MQTT,
  meshtasticContactGroupMatchesBuiltinGps,
  meshtasticContactGroupMatchesBuiltinRfMqtt,
} from './meshtasticContactGroupUtils';

function node(partial: Partial<NodeRecord> & Pick<NodeRecord, 'nodeId'>): NodeRecord {
  return {
    longName: 'N',
    shortName: '',
    hwModel: '',
    snr: 0,
    batteryLevel: 0,
    lastHeardAt: 0,
    ...partial,
  };
}

describe('meshtasticContactGroupMatchesBuiltinGps', () => {
  it('includes nodes with valid non-zero coordinates and excludes self', () => {
    expect(
      meshtasticContactGroupMatchesBuiltinGps(
        node({ nodeId: 10, latitude: 37.5, longitude: -122.4 }),
        99,
      ),
    ).toBe(true);
    expect(
      meshtasticContactGroupMatchesBuiltinGps(
        node({ nodeId: 99, latitude: 37.5, longitude: -122.4 }),
        99,
      ),
    ).toBe(false);
  });

  it('rejects 0,0 and null coordinates', () => {
    expect(
      meshtasticContactGroupMatchesBuiltinGps(node({ nodeId: 1, latitude: 0, longitude: 0 }), 0),
    ).toBe(false);
    expect(
      meshtasticContactGroupMatchesBuiltinGps(node({ nodeId: 1, latitude: 0, longitude: 0 }), 1),
    ).toBe(false);
    expect(
      meshtasticContactGroupMatchesBuiltinGps(
        node({ nodeId: 2 }),
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
        node({ nodeId: 5, heardViaMqtt: true, heardViaMqttOnly: false }),
        1,
      ),
    ).toBe(true);
    expect(
      meshtasticContactGroupMatchesBuiltinRfMqtt(
        node({ nodeId: 5, heardViaMqtt: true, heardViaMqttOnly: true }),
        1,
      ),
    ).toBe(false);
    expect(
      meshtasticContactGroupMatchesBuiltinRfMqtt(
        node({ nodeId: 5, heardViaMqtt: false, heardViaMqttOnly: false }),
        1,
      ),
    ).toBe(false);
  });

  it('excludes self', () => {
    expect(
      meshtasticContactGroupMatchesBuiltinRfMqtt(
        node({ nodeId: 1, heardViaMqtt: true, heardViaMqttOnly: false }),
        1,
      ),
    ).toBe(false);
  });
});

describe('isMeshtasticContactEligibleForUserGroup', () => {
  it('allows non-self when self is known', () => {
    expect(isMeshtasticContactEligibleForUserGroup(node({ nodeId: 2 }), 1)).toBe(true);
    expect(isMeshtasticContactEligibleForUserGroup(node({ nodeId: 1 }), 1)).toBe(false);
  });

  it('rejects when self unknown', () => {
    expect(isMeshtasticContactEligibleForUserGroup(node({ nodeId: 2 }), null)).toBe(false);
    expect(isMeshtasticContactEligibleForUserGroup(node({ nodeId: 2 }), 0)).toBe(false);
  });
});
