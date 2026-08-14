import { describe, expect, it } from 'vitest';

import { shouldPlayRrcNotification } from './rrcNotificationGate';

describe('shouldPlayRrcNotification', () => {
  it('plays dm while watching the active room; skips channel', () => {
    expect(
      shouldPlayRrcNotification({
        onRrcPanel: true,
        windowInactive: false,
        forOtherRoom: false,
        type: 'dm',
      }),
    ).toBe(true);
    expect(
      shouldPlayRrcNotification({
        onRrcPanel: true,
        windowInactive: false,
        forOtherRoom: false,
        type: 'channel',
      }),
    ).toBe(false);
  });

  it('plays channel when off panel, inactive window, or other room (toggle-on path)', () => {
    expect(
      shouldPlayRrcNotification({
        onRrcPanel: false,
        windowInactive: false,
        forOtherRoom: false,
        type: 'channel',
      }),
    ).toBe(true);
    expect(
      shouldPlayRrcNotification({
        onRrcPanel: true,
        windowInactive: true,
        forOtherRoom: false,
        type: 'channel',
      }),
    ).toBe(true);
    expect(
      shouldPlayRrcNotification({
        onRrcPanel: true,
        windowInactive: false,
        forOtherRoom: true,
        type: 'channel',
      }),
    ).toBe(true);
  });

  it('returns false when type is null', () => {
    expect(
      shouldPlayRrcNotification({
        onRrcPanel: false,
        windowInactive: false,
        forOtherRoom: false,
        type: null,
      }),
    ).toBe(false);
  });
});
