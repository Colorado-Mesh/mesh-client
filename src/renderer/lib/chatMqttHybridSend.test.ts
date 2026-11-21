import { describe, expect, it } from 'vitest';

import { protocolMqttProvidesChatSend } from './chatMqttHybridSend';

describe('protocolMqttProvidesChatSend', () => {
  it('is true only for Meshtastic', () => {
    expect(protocolMqttProvidesChatSend('meshtastic')).toBe(true);
    expect(protocolMqttProvidesChatSend('meshcore')).toBe(false);
    expect(protocolMqttProvidesChatSend('meshcom')).toBe(false);
    expect(protocolMqttProvidesChatSend('reticulum')).toBe(false);
  });
});
