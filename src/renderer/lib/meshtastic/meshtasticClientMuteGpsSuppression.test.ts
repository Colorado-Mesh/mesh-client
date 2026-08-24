import { describe, expect, it } from 'vitest';

import {
  buildClientMuteMqttSuppressValue,
  buildClientMutePositionSuppressValue,
  MESHTASTIC_CLIENT_MUTE_ROLE,
} from './meshtasticClientMuteGpsSuppression';

describe('meshtasticClientMuteGpsSuppression', () => {
  it('exports Client Mute role constant', () => {
    expect(MESHTASTIC_CLIENT_MUTE_ROLE).toBe(1);
  });

  it('merges position suppress fields while preserving device slice', () => {
    const merged = buildClientMutePositionSuppressValue({
      gpsMode: 2,
      positionBroadcastSecs: 900,
      fixedPosition: true,
    });
    expect(merged).toMatchObject({
      gpsMode: 0,
      positionBroadcastSecs: 0,
      fixedPosition: true,
    });
  });

  it('merges mqtt map report off while preserving device slice', () => {
    const merged = buildClientMuteMqttSuppressValue({
      enabled: true,
      mapReportingEnabled: true,
      address: 'mqtt.example.com',
    });
    expect(merged).toMatchObject({
      enabled: true,
      mapReportingEnabled: false,
      address: 'mqtt.example.com',
    });
  });
});
