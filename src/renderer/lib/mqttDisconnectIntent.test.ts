import { beforeEach, describe, expect, it } from 'vitest';

import { consumeMqttUserDisconnect, markMqttUserDisconnect } from './mqttDisconnectIntent';

describe('mqttDisconnectIntent', () => {
  beforeEach(() => {
    // Drain any leftover flag from prior tests.
    consumeMqttUserDisconnect();
  });

  it('starts unset and consume returns false', () => {
    expect(consumeMqttUserDisconnect()).toBe(false);
  });

  it('mark then consume returns true once', () => {
    markMqttUserDisconnect();
    expect(consumeMqttUserDisconnect()).toBe(true);
    expect(consumeMqttUserDisconnect()).toBe(false);
  });
});
