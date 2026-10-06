import { describe, expect, it } from 'vitest';

import {
  isNotificationSoundEvent,
  MAX_NOTIFICATION_SOUND_BYTES,
  MAX_NOTIFICATION_SOUND_SECONDS,
  NOTIFICATION_SOUND_EVENTS,
} from './notificationSounds';

describe('notificationSounds', () => {
  it('exposes defined limits for imported notification sounds', () => {
    expect(MAX_NOTIFICATION_SOUND_BYTES).toBe(2 * 1024 * 1024);
    expect(MAX_NOTIFICATION_SOUND_SECONDS).toBe(10);
  });

  it('validates all known notification sound events', () => {
    for (const event of NOTIFICATION_SOUND_EVENTS) {
      expect(isNotificationSoundEvent(event)).toBe(true);
    }
  });

  it('rejects unknown event strings or invalid types', () => {
    expect(isNotificationSoundEvent('unknown')).toBe(false);
    expect(isNotificationSoundEvent('alert')).toBe(false);
    expect(isNotificationSoundEvent('')).toBe(false);
    expect(isNotificationSoundEvent(null)).toBe(false);
    expect(isNotificationSoundEvent(undefined)).toBe(false);
    expect(isNotificationSoundEvent(123)).toBe(false);
    expect(isNotificationSoundEvent({})).toBe(false);
  });
});
