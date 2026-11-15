// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { validateMqttPublishWaypointArgs } from './mqttPublishWaypointValidation';

const DEG = 1e7;

function baseArgs(boundingBox?: Record<string, number>) {
  return {
    publishJsonMirror: false,
    from: 1,
    to: 0xffffffff,
    channel: 0,
    channelName: 'LongFast',
    waypoint: {
      id: 1,
      latitudeI: 40 * DEG,
      longitudeI: -105 * DEG,
      name: 'Camp',
      ...(boundingBox ? { boundingBox } : {}),
    },
  };
}

describe('validateMqttPublishWaypointArgs bounding box', () => {
  it('accepts in-range ordered boxes including geographic boundaries', () => {
    expect(() => {
      validateMqttPublishWaypointArgs(
        baseArgs({
          longitudeWestI: -180 * DEG,
          latitudeSouthI: -90 * DEG,
          longitudeEastI: 180 * DEG,
          latitudeNorthI: 90 * DEG,
        }),
      );
    }).not.toThrow();
  });

  it('rejects coordinates outside lon ±180 / lat ±90 and unordered boxes', () => {
    expect(() => {
      validateMqttPublishWaypointArgs(
        baseArgs({
          longitudeWestI: -181 * DEG,
          latitudeSouthI: 0,
          longitudeEastI: -170 * DEG,
          latitudeNorthI: 1 * DEG,
        }),
      );
    }).toThrow(/longitudeWestI invalid/);
    expect(() => {
      validateMqttPublishWaypointArgs(
        baseArgs({
          longitudeWestI: -10 * DEG,
          latitudeSouthI: 20 * DEG,
          longitudeEastI: -5 * DEG,
          latitudeNorthI: 91 * DEG,
        }),
      );
    }).toThrow(/latitudeNorthI invalid/);
    expect(() => {
      validateMqttPublishWaypointArgs(
        baseArgs({
          longitudeWestI: 10 * DEG,
          latitudeSouthI: 0,
          longitudeEastI: 5 * DEG,
          latitudeNorthI: 1 * DEG,
        }),
      );
    }).toThrow(/ordering invalid/);
  });
});
