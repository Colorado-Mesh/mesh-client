import { describe, expect, it } from 'vitest';

import {
  shouldAutoLaunchMeshtasticMqtt,
  shouldIngestMeshtasticMqttLive,
} from './meshtasticMqttLiveIngest';

describe('shouldIngestMeshtasticMqttLive', () => {
  it('blocks live ingest for MeshCore tab without RF', () => {
    expect(shouldIngestMeshtasticMqttLive('meshcore', false)).toBe(false);
  });

  it('allows live ingest on Meshtastic tab without RF (MQTT-only)', () => {
    expect(shouldIngestMeshtasticMqttLive('meshtastic', false)).toBe(true);
  });

  it('allows live ingest on MeshCore tab when Meshtastic RF is connected', () => {
    expect(shouldIngestMeshtasticMqttLive('meshcore', true)).toBe(true);
  });
});

describe('shouldAutoLaunchMeshtasticMqtt', () => {
  it('auto-launches only when Meshtastic is the stored protocol', () => {
    expect(shouldAutoLaunchMeshtasticMqtt('meshtastic')).toBe(true);
    expect(shouldAutoLaunchMeshtasticMqtt('meshcore')).toBe(false);
  });
});
