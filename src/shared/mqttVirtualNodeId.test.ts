import { describe, expect, it } from 'vitest';

import {
  isStoredMqttVirtualNodeId,
  MQTT_VIRTUAL_NODE_ID_MAX,
  randomMqttVirtualNodeId,
} from './mqttVirtualNodeId';

describe('mqttVirtualNodeId', () => {
  it('accepts ids in 1..0x0FFFFFFF and rejects broadcast-range values', () => {
    expect(isStoredMqttVirtualNodeId(1)).toBe(true);
    expect(isStoredMqttVirtualNodeId(MQTT_VIRTUAL_NODE_ID_MAX)).toBe(true);
    expect(isStoredMqttVirtualNodeId(0)).toBe(false);
    expect(isStoredMqttVirtualNodeId(0xffffffff)).toBe(false);
    expect(isStoredMqttVirtualNodeId(MQTT_VIRTUAL_NODE_ID_MAX + 1)).toBe(false);
  });

  it('maps random uint32 into valid range', () => {
    expect(randomMqttVirtualNodeId(0)).toBe(1);
    expect(randomMqttVirtualNodeId(0xffffffff)).toBe(MQTT_VIRTUAL_NODE_ID_MAX);
    expect(randomMqttVirtualNodeId(0x12345678)).toBe(0x02345678);
  });
});
