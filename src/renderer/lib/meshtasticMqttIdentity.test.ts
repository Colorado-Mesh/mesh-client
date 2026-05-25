import { describe, expect, it } from 'vitest';

import { mqttOnlyIdentitySource, resolveMqttOnlyFromNodeId } from './meshtasticMqttIdentity';

describe('resolveMqttOnlyFromNodeId', () => {
  it('prefers last RF node id when set', () => {
    expect(resolveMqttOnlyFromNodeId(0x88cb6530, 0x0b2f75f3)).toBe(0x88cb6530);
  });

  it('falls back to virtual id when no RF session', () => {
    expect(resolveMqttOnlyFromNodeId(0, 0x0b2f75f3)).toBe(0x0b2f75f3);
  });
});

describe('mqttOnlyIdentitySource', () => {
  it('reports lastRf when RF node id is known', () => {
    expect(mqttOnlyIdentitySource(0x123)).toBe('lastRf');
  });

  it('reports virtual when RF node id is zero', () => {
    expect(mqttOnlyIdentitySource(0)).toBe('virtual');
  });
});
