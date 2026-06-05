import { describe, expect, it } from 'vitest';

import {
  meshtasticNodeShowsHybridMqttPath,
  resolveMeshtasticPathBadge,
} from './meshtasticSourceIcons';
import type { MeshNode } from './types';

function node(
  partial: Pick<MeshNode, 'heard_via_mqtt' | 'heard_via_mqtt_only' | 'via_mqtt'>,
): Pick<MeshNode, 'heard_via_mqtt' | 'heard_via_mqtt_only' | 'via_mqtt'> {
  return partial;
}

describe('resolveMeshtasticPathBadge', () => {
  it('returns mqttOnly for heard_via_mqtt_only nodes', () => {
    expect(
      resolveMeshtasticPathBadge({
        node: node({ heard_via_mqtt_only: true, heard_via_mqtt: true }),
      }),
    ).toBe('mqttOnly');
  });

  it('returns hybrid for self with RF and MQTT connected', () => {
    expect(
      resolveMeshtasticPathBadge({
        node: node({ heard_via_mqtt_only: false }),
        isSelf: true,
        mqttConnected: true,
        radioConnected: true,
      }),
    ).toBe('hybrid');
  });

  it('returns mqttOnly for self with MQTT only', () => {
    expect(
      resolveMeshtasticPathBadge({
        node: node({ heard_via_mqtt_only: false }),
        isSelf: true,
        mqttConnected: true,
        radioConnected: false,
      }),
    ).toBe('mqttOnly');
  });

  it('returns rfOnly for self with RF only', () => {
    expect(
      resolveMeshtasticPathBadge({
        node: node({ heard_via_mqtt_only: false }),
        isSelf: true,
        mqttConnected: false,
        radioConnected: true,
      }),
    ).toBe('rfOnly');
  });

  it('returns hybrid for remote nodes with session or packet MQTT path', () => {
    expect(
      resolveMeshtasticPathBadge({
        node: node({ heard_via_mqtt_only: false, heard_via_mqtt: true }),
      }),
    ).toBe('hybrid');
    expect(
      resolveMeshtasticPathBadge({
        node: node({ heard_via_mqtt_only: false, via_mqtt: true }),
      }),
    ).toBe('hybrid');
  });

  it('returns none for RF-only remote nodes', () => {
    expect(
      resolveMeshtasticPathBadge({
        node: node({ heard_via_mqtt_only: false }),
      }),
    ).toBe('none');
    expect(meshtasticNodeShowsHybridMqttPath(node({ heard_via_mqtt_only: false }))).toBe(false);
  });
});
